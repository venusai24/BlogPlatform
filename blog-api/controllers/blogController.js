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
const { generateEmbedding, cosineSimilarity } = require('../services/embeddingService');
const redisClient = require('../services/redisClient');

exports.semanticSearch = async (req, res) => {
    const { query, limit = 10, threshold = 0.3 } = req.body;

    if (!query) {
        return res.status(400).json({ message: "Search query is required" });
    }

    try {
        // Create a safe Redis key
        const redisKey = `query-embedding:${crypto.createHash('sha256').update(query).digest('hex')}`;

        // Try to retrieve embedding from Redis cache
        let queryEmbedding;
        const cached = await redisClient.get(redisKey);

        if (cached) {
            queryEmbedding = JSON.parse(cached);
        } else {
            queryEmbedding = await generateEmbedding(query);
            await redisClient.set(redisKey, JSON.stringify(queryEmbedding), {
                EX: 86400 // cache for 24 hours
            });
        }

        // Fetch all blogs with embeddings
        const blogs = await BlogContent.find({
            $or: [
                { titleEmbedding: { $exists: true, $ne: [] } },
                { contentEmbedding: { $exists: true, $ne: [] } },
                { summaryEmbedding: { $exists: true, $ne: [] } }
            ]
        });

        const results = blogs.map(blog => {
            let maxSimilarity = 0;
            let bestMatch = '';

            if (Array.isArray(blog.titleEmbedding)) {
                const sim = cosineSimilarity(queryEmbedding, blog.titleEmbedding);
                if (sim > maxSimilarity) {
                    maxSimilarity = sim;
                    bestMatch = 'title';
                }
            }

            if (Array.isArray(blog.contentEmbedding)) {
                const sim = cosineSimilarity(queryEmbedding, blog.contentEmbedding);
                if (sim > maxSimilarity) {
                    maxSimilarity = sim;
                    bestMatch = 'content';
                }
            }

            if (Array.isArray(blog.summaryEmbedding)) {
                const sim = cosineSimilarity(queryEmbedding, blog.summaryEmbedding);
                if (sim > maxSimilarity) {
                    maxSimilarity = sim;
                    bestMatch = 'summary';
                }
            }

            return {
                _id: blog._id,
                title: blog.title,
                author: blog.author,
                summary: blog.summary,
                similarity: maxSimilarity,
                matchField: bestMatch,
                createdAt: blog.createdAt
            };
        })
        .filter(result => result.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

        res.status(200).json({
            message: "Semantic search completed",
            query,
            results: results.map(r => ({
                _id: r._id,
                title: r.title,
                author: r.author,
                summary: r.summary,
                similarity: Math.round(r.similarity * 100) / 100,
                matchField: r.matchField,
                createdAt: r.createdAt
            }))
        });
    } catch (error) {
        console.error("Error in semantic search:", error);
        res.status(500).json({ message: "Server error" });
    }
};
