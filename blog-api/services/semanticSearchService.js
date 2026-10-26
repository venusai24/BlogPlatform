const { getVectorStore } = require('./vectorStore');
const { embed } = require('./embeddingService');
const postIndexer = require('./indexing/postIndexer');
const logger = require('../src/utils/logger');
const llmService = require('./llmService');
const BlogContent = require('../model/BlogContent');

const searchBlogs = async (query, options = {}) => {
  let timeoutId;
  try {
    const { searchType = 'content', limit = 5, minDenseScore = 0 } = options;
    
    const searchPromise = async () => {
      // 1. Transform query (HyDE & Query Rewriting)
      const expandedQuery = await llmService.transformQuery(query);

      // 2. Lexical Search (BM25 via MongoDB)
      const lexicalResults = await BlogContent.find(
          { $text: { $search: query } },
          { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(parseInt(limit) * 4)
      .lean();

      // 3. Dense Vector Search (Qdrant)
      const queryEmbeddings = await embed([expandedQuery]);
      if (!queryEmbeddings || queryEmbeddings.length === 0) return [];
      const queryEmbedding = queryEmbeddings[0];
      
      const store = getVectorStore();

      let targetCollections = [];
      if (searchType === 'hybrid') {
        targetCollections = ['blog_titles', 'blog_content', 'blog_summaries'];
      } else if (searchType === 'title') {
        targetCollections = ['blog_titles'];
      } else {
        // Default content search also includes summaries for thematic matching
        targetCollections = ['blog_content', 'blog_summaries'];
      }

      const allResults = [];
      for (const collection of targetCollections) {
        try {
          const results = await store.search(collection, queryEmbedding, parseInt(limit) * 4);
          allResults.push(...results);
        } catch(e) {
          logger.warn({err: e, collection}, "Error searching Qdrant collection");
        }
      }

      const uniqueBlogs = new Map();
      for (const match of allResults) {
        if (!match.payload) continue;
        if (match.score < minDenseScore) continue;
        const blogId = match.payload.blogId;
        if (!uniqueBlogs.has(blogId)) {
          uniqueBlogs.set(blogId, {
            id: blogId,
            score: match.score,
            title: match.payload.title,
            snippet: match.payload.snippet,
            author: match.payload.author
          });
        } else {
           if (match.score > uniqueBlogs.get(blogId).score) {
               uniqueBlogs.get(blogId).score = match.score;
               uniqueBlogs.get(blogId).snippet = match.payload.snippet;
           }
        }
      }

      // 4. Reciprocal Rank Fusion (RRF)
      const rrfScores = new Map();
      const RRF_K = 60;
      
      // Add Lexical to RRF
      lexicalResults.forEach((doc, index) => {
          const blogId = doc._id.toString();
          const rrfScore = 1 / (RRF_K + index + 1);
          rrfScores.set(blogId, {
              id: blogId,
              score: rrfScore, // initial score
              title: doc.title,
              snippet: doc.content ? doc.content.substring(0, 300) : '',
              author: doc.author,
              denseScore: null // lexical-only until a dense hit for the same post is fused in
          });
      });

      // Add Dense to RRF
      const sortedDense = Array.from(uniqueBlogs.values()).sort((a,b) => b.score - a.score);
      sortedDense.forEach((doc, index) => {
          const blogId = doc.id;
          const rrfScore = 1 / (RRF_K + index + 1);
          if (rrfScores.has(blogId)) {
              const entry = rrfScores.get(blogId);
              entry.score += rrfScore; // Add scores for fusion
              entry.denseScore = doc.score;
          } else {
              rrfScores.set(blogId, {
                  id: blogId,
                  score: rrfScore,
                  title: doc.title,
                  snippet: doc.snippet,
                  author: doc.author,
                  denseScore: doc.score // max cosine for this post
              });
          }
      });
      
      // 5. Sort by combined RRF score and return
      let finalResults = Array.from(rrfScores.values()).sort((a, b) => b.score - a.score);
      
      return finalResults.slice(0, parseInt(limit));
    };

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Qdrant search timeout')), 30000);
    });

    return await Promise.race([searchPromise(), timeoutPromise]);
  } catch (error) {
    if (error.message === 'Qdrant search timeout' || error.message.includes('fetch') || error.code === 'ECONNREFUSED') {
      logger.warn('Qdrant search timed out or unreachable, falling back');
      return null;
    }
    logger.error({ err: error }, 'Error in semantic search');
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

module.exports = {
  indexBlogPost: postIndexer.indexPost,
  searchBlogs,
  deleteBlogEmbeddings: postIndexer.removePost
};
