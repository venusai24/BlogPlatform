const summarizeService = require('../services/summarize');

exports.summarize = async (req, res) => {
    const { content, model } = req.body;
    if (!content) {
        return res.status(400).json({ message: 'Content is required' });
    }
    try {
        const jobId = await summarizeService.queueSummarization(content, model);
        res.status(202).json({ message: 'Summarization job queued', jobId });
    } catch (error) {
        console.error('Error queueing summarization:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.summarizeStatus = async (req, res) => {
    const { jobId } = req.params;
    try {
        const status = await summarizeService.getSummarizationStatus(jobId);
        res.status(200).json(status);
    } catch (error) {
        console.error('Error fetching summarization status:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const crypto = require('crypto');
const BlogContent = require('../model/BlogContent');
const { generateSentenceSimilarityWithHuggingFace} = require('../services/embeddingService');
const redisClient = require('../services/redisClient');

exports.semanticSearch = async (req, res) => {
  const { query, limit = 10, threshold = 0.3 } = req.body;

  if (!query) {
    return res.status(400).json({ message: "Search query is required" });
  }

  try {
    // Fetch all blogs
    const blogs = await BlogContent.find({
      $or: [
        { title: { $exists: true } },
        { summary: { $exists: true } },
        { content: { $exists: true } }
      ]
    });

    // Prepare candidates (e.g., titles)
    const candidates = blogs.map(blog => blog.title);

    // Get similarity scores from HF API
    const scores = await generateSentenceSimilarityWithHuggingFace(query, candidates);

    // Combine scores with blogs
    const results = blogs.map((blog, idx) => ({
      _id: blog._id,
      title: blog.title,
      author: blog.author,
      summary: blog.summary,
      similarity: scores[idx],
      createdAt: blog.createdAt
    }))
    .filter(result => result.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

    res.status(200).json({
      message: "Semantic search completed with scoring",
      query,
      results: results.map(r => ({
        _id: r._id,
        title: r.title,
        author: r.author,
        summary: r.summary,
        similarity: Math.round(r.similarity * 100) / 100,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    console.error("Error in semantic search:", error);
    res.status(500).json({ message: "Server error" });
  }
};
