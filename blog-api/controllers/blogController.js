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

exports.semanticSearchSummary = async (req, res) => {
    const { query, limit = 10, threshold = 0.8 } = req.body;
    if (!query) {
        return res.status(400).json({ message: 'Query is required' });
    }
    try {
        const { generateEmbedding, cosineSimilarity } = require('../services/embeddingService');
        const redisClient = require('../services/redisClient');
        const queryEmbedding = await generateEmbedding(query);
        const keys = await redisClient.keys('summary-embedding:*');
        const results = [];
        for (const key of keys) {
            const cached = await redisClient.get(key);
            if (cached) {
                const { embedding, summary } = JSON.parse(cached);
                const similarity = cosineSimilarity(queryEmbedding, embedding);
                if (similarity >= threshold) {
                    results.push({ summary, similarity });
                }
            }
        }
        results.sort((a, b) => b.similarity - a.similarity);
        res.status(200).json({ results: results.slice(0, limit) });
    } catch (error) {
        console.error('Error in semantic search:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
