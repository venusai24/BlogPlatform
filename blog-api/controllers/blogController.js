const summarizeService = require('../services/summarize');
const logger = require('../src/utils/logger');

exports.summarize = async (req, res) => {
    const { content, model } = req.body;
    if (!content) {
        return res.status(400).json({ message: 'Content is required' });
    }
    try {
        const jobId = await summarizeService.queueSummarization(content, model);
        logger.info({ jobId, contentLength: content.length }, 'Summarization job queued');
        res.status(202).json({ message: 'Summarization job queued', jobId });
    } catch (error) {
        logger.error({ err: error }, 'Error queueing summarization');
        res.status(500).json({ message: 'Server error' });
    }
};

exports.summarizeStatus = async (req, res) => {
    const { jobId } = req.params;
    try {
        const status = await summarizeService.getSummarizationStatus(jobId);
        res.status(200).json(status);
    } catch (error) {
        logger.error({ err: error, jobId }, 'Error fetching summarization status');
        res.status(500).json({ message: 'Server error' });
    }
};

const BlogContent = require('../model/BlogContent');
const escapeRegex = require('../utils/escapeRegex');

exports.semanticSearchbyTitle = async (req, res) => {
  const { query, limit = 10, threshold = 0.3 } = req.body;

  if (!query) {
    return res.status(400).json({ message: "Search query is required" });
  }

  try {
    const semanticSearchService = require('../services/semanticSearchService');
    const qdrantResults = await semanticSearchService.searchBlogs(query, {
      searchType: 'title',
      limit: parseInt(limit),
      minDenseScore: Number(threshold)
    });

    if (!qdrantResults) {
      // Fallback to basic text search if Qdrant is unavailable
      const fallbackBlogs = await BlogContent.find({ 
          title: { $regex: escapeRegex(query), $options: 'i' } 
      }).limit(parseInt(limit));
      
      return res.status(200).json({
          message: "Semantic search unavailable, fallback to text search",
          query,
          results: fallbackBlogs.map(b => ({
              _id: b._id,
              title: b.title,
              author: b.author,
              similarity: 1.0,
              createdAt: b.createdAt
          }))
      });
    }

    if (qdrantResults.length === 0) {
      return res.status(200).json({ message: "No blogs found", query, results: [] });
    }

    // The threshold is applied to dense (cosine) scores inside searchBlogs; the fused RRF
    // `score` is on a different scale. Title search only returns dense matches.
    const filteredQdrant = qdrantResults.filter(r => r.denseScore !== null);

    // Fetch full blog info from DB to get createdAt, etc.
    const blogIds = filteredQdrant.map(r => r.id);
    const blogsFromDb = await BlogContent.find({ _id: { $in: blogIds } });

    // Map back to original structure
    const results = filteredQdrant.map(qRes => {
      const dbBlog = blogsFromDb.find(b => b._id.toString() === qRes.id);
      if (!dbBlog) return null;
      return {
        _id: dbBlog._id,
        title: dbBlog.title,
        author: dbBlog.author,
        similarity: qRes.denseScore,
        createdAt: dbBlog.createdAt
      };
    }).filter(r => r !== null);

    res.status(200).json({
      message: "Semantic search completed with scoring",
      query,
      results: results.map(r => ({
        _id: r._id,
        title: r.title,
        author: r.author,
        similarity: Math.round(r.similarity * 100) / 100,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    logger.error({ err: error }, 'Error in semantic search');
    res.status(500).json({ message: "Server error" });
  }
};
