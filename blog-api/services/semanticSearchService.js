const { QdrantClient } = require("@qdrant/js-client-rest");
const { generateEmbedding } = require('./embeddingService');
const { v4: uuidv4 } = require('uuid');

const COLLECTION_NAME = 'blog-platform';

const initQdrantClient = () => {
  return new QdrantClient({ 
    url: process.env.QDRANT_URL || 'http://localhost:6333'
  });
};

const chunkText = (text, maxChars = 500) => {
  if (!text) return [];
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';
  
  for (const para of paragraphs) {
      if (currentChunk.length + para.length > maxChars && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = para;
      } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
  }
  if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
  }
  return chunks;
};

const indexBlogPost = async (blog) => {
  try {
    const client = initQdrantClient();
    const points = [];

    // 1. Index Title
    const titleEmbedding = await generateEmbedding(blog.title);
    points.push({
      id: uuidv4(),
      vector: titleEmbedding,
      payload: {
        blogId: blog._id.toString(),
        type: 'title',
        title: blog.title,
        snippet: blog.content.substring(0, 200),
        author: blog.author
      }
    });

    // 2. Index Content Chunks
    const chunks = chunkText(blog.content);
    const contentEmbeddings = await Promise.all(chunks.map(chunk => generateEmbedding(chunk)));

    chunks.forEach((chunk, index) => {
      points.push({
        id: uuidv4(),
        vector: contentEmbeddings[index],
        payload: {
          blogId: blog._id.toString(),
          type: 'content',
          title: blog.title,
          content: blog.content,
          snippet: chunk, // RAG Snippet
          author: blog.author
        }
      });
    });

    await client.upsert(COLLECTION_NAME, { points });
    console.log(`[SemanticSearchService] Blog indexed in Qdrant with ${chunks.length} chunks: ${blog._id}`);
  } catch (error) {
    console.error('Error indexing blog post:', error);
    throw error;
  }
};

const verifyCollection = async (client) => {
  try {
    const collections = await client.getCollections();
    
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
    return true;
  } catch (error) {
    console.error('Error verifying/creating collection:', error);
    throw error;
  }
};

const searchBlogs = async (query, options = {}) => {
  try {
    if (!query || typeof query !== 'string') {
      throw new Error('Invalid query: ' + JSON.stringify(query));
    }
    
    const {
      searchType = 'content',
      limit = 5
    } = options;
    
    let validType = 'content';
    if (typeof searchType === 'string') {
      const type = searchType.toLowerCase();
      if (type === 'hybrid') {
        validType = ['title', 'content'];
      } else if (['title', 'content'].includes(type)) {
        validType = type;
      }
    }
    
    const queryEmbedding = await generateEmbedding(query);
    const client = initQdrantClient();
    await verifyCollection(client);

    const searchParams = {
      vector: queryEmbedding,
      limit: parseInt(limit) * 3, // Fetch more to allow for deduping
      with_payload: true,
      with_vectors: false
    };

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

    const results = await client.search(COLLECTION_NAME, searchParams);

    if (!results || !Array.isArray(results)) {
      return [];
    }

    // Deduplicate by blogId, keeping the highest scoring chunk
    const uniqueBlogs = new Map();

    for (const match of results) {
      if (!match.payload) continue;
      const blogId = match.payload.blogId;

      if (!uniqueBlogs.has(blogId)) {
        uniqueBlogs.set(blogId, {
          id: blogId,
          score: match.score,
          title: match.payload.title,
          snippet: match.payload.snippet, // This is now the specific chunk
          author: match.payload.author
        });
      }
    }

    // Convert map to array and take top `limit` results
    const finalResults = Array.from(uniqueBlogs.values()).slice(0, parseInt(limit));
    return finalResults;
  } catch (error) {
    console.error('Error in semantic search:', error);
    throw error;
  }
};

const deleteBlogEmbeddings = async (blogId) => {
  try {
    const client = initQdrantClient();
    
    // Delete all chunks for this blog post using payload filter
    await client.delete(COLLECTION_NAME, {
      filter: {
        must: [
          {
            key: 'blogId',
            match: { value: blogId.toString() }
          }
        ]
      }
    });
    
    console.log(`[SemanticSearchService] Blog embeddings deleted from Qdrant: ${blogId}`);
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
