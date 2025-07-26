const { QdrantClient } = require("@qdrant/js-client-rest");
const { generateEmbedding } = require('./embeddingService');

const COLLECTION_NAME = 'blog-platform';

const initQdrantClient = () => {
  return new QdrantClient({ 
    url: process.env.QDRANT_URL || 'http://localhost:6333'
  });
};

const indexBlogPost = async (blog) => {
  try {
    const [titleEmbedding, contentEmbedding] = await Promise.all([
      generateEmbedding(blog.title),
      generateEmbedding(blog.content)
    ]);

    const client = initQdrantClient();

    // Convert MongoDB ObjectId to a positive integer for Qdrant
    const idNum = parseInt(blog._id.toString().substring(0, 8), 16);
    
    // Index both title and content vectors
    await client.upsert(COLLECTION_NAME, {
      points: [
        {
          id: idNum * 2, // Even numbers for title vectors
          vector: titleEmbedding,
          payload: {
            blogId: blog._id.toString(),
            type: 'title',
            title: blog.title,
            snippet: blog.content.substring(0, 200)
          }
        },
        {
          id: idNum * 2 + 1, // Odd numbers for content vectors
          vector: contentEmbedding,
          payload: {
            blogId: blog._id.toString(),
            type: 'content',
            title: blog.title,
            content: blog.content
          }
        }
      ]
    });

    console.log(`[SemanticSearchService] Blog indexed in Qdrant: ${blog._id}`);
  } catch (error) {
    console.error('Error indexing blog post:', error);
    throw error;
  }
};

const verifyCollection = async (client) => {
  try {
    const collections = await client.getCollections();
    console.log('Available collections:', JSON.stringify(collections, null, 2));
    
    // Check if our collection exists in the list of collections
    const collectionExists = collections.collections?.some(c => c.name === COLLECTION_NAME);
    
    if (!collectionExists) {
      console.log('Collection not found, attempting to create it...');
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 384,  // MiniLM-L6-v2 embedding size
          distance: "Cosine"
        }
      });
      
      // Create payload index for type field
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "type",
        field_schema: "keyword"
      });
      
      console.log('Collection created successfully');
      return true;
    }
    
    // Get specific collection info
    const collection = await client.getCollection(COLLECTION_NAME);
    console.log('Collection info:', JSON.stringify(collection, null, 2));
    return true;
  } catch (error) {
    console.error('Error verifying/creating collection:', error);
    throw error;
  }
};

const searchBlogs = async (query, options = {}) => {
  try {
    // Validate inputs
    if (!query || typeof query !== 'string') {
      throw new Error('Invalid query: ' + JSON.stringify(query));
    }
    
    const {
      searchType = 'content',
      limit = 5
    } = options;
    
    // Handle searchType validation
    let validType = 'content';
    if (typeof searchType === 'string') {
      const type = searchType.toLowerCase();
      if (type === 'hybrid') {
        validType = ['title', 'content'];  // Search both types for hybrid search
      } else if (['title', 'content'].includes(type)) {
        validType = type;
      }
    }
    
    console.log('Search configuration:', {
      query,
      searchType: validType,
      limit
    });
    const queryEmbedding = await generateEmbedding(query);
    const client = initQdrantClient();
    
    // Verify collection exists and is configured
    await verifyCollection(client);

    const searchParams = {
      vector: queryEmbedding,
      limit: parseInt(limit),
      with_payload: true,
      with_vectors: false
    };

    // Add type filter if not doing hybrid search
    if (!Array.isArray(validType)) {
      searchParams.filter = {
        must: [
          {
            key: 'type',
            match: { value: validType }
          }
        ]
      };
    }

    console.log('Searching Qdrant with query:', {
      queryLength: query.length,
      searchType,
      embeddingLength: queryEmbedding.length
    });

    console.log('Search params:', JSON.stringify(searchParams, null, 2));
    
    const results = await client.search(COLLECTION_NAME, searchParams);
    
    console.log('Qdrant search results:', JSON.stringify(results, null, 2));

    if (!results || !Array.isArray(results)) {
      console.error('Invalid results format from Qdrant:', results);
      return [];
    }

    const mappedResults = results.map(match => {
      if (!match.payload) {
        console.error('Match missing payload:', match);
        return null;
      }
      return {
        id: match.payload.blogId,
        score: match.score,
        title: match.payload.title,
        snippet: match.payload.snippet || match.payload.content?.substring(0, 200)
      };
    }).filter(Boolean); // Remove any null results

    console.log('Mapped results:', JSON.stringify(mappedResults, null, 2));
    return mappedResults;
  } catch (error) {
    console.error('Error in semantic search:', error);
    throw error;
  }
};

const deleteBlogEmbeddings = async (blogId) => {
  try {
    const client = initQdrantClient();
    
    // Convert MongoDB ObjectId to the same integer IDs used in indexing
    const idNum = parseInt(blogId.toString().substring(0, 8), 16);
    const titleId = idNum * 2;
    const contentId = idNum * 2 + 1;
    
    await client.delete(COLLECTION_NAME, {
      points: [titleId, contentId]
    });
    
    console.log(`[SemanticSearchService] Blog embeddings deleted from Qdrant: ${blogId} (points ${titleId}, ${contentId})`);
  } catch (error) {
    console.error('Error deleting blog embeddings:', error);
    throw error;
  }
};

module.exports = {
  indexBlogPost,
  searchBlogs,
  deleteBlogEmbeddings
};
