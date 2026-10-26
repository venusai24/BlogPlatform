const semanticSearchService = require('../services/semanticSearchService');
const llmService = require('../services/llmService');
const monitoringService = require('../services/monitoringService');
const logger = require('../src/utils/logger');

async function lexicalSearch(query, limit) {
    const BlogContent = require('../model/BlogContent');
    const mongoResults = await BlogContent.find(
        { $text: { $search: query } },
        { score: { $meta: "textScore" } }
    )
    .sort({ score: { $meta: "textScore" } })
    .limit(parseInt(limit));

    return mongoResults.map(result => ({
        id: result._id,
        title: result.title,
        snippet: result.content.substring(0, 200),
        score: result._doc.score || 1,
        author: result.author
    }));
}

class BlogSearchController {
    async searchBlogs(req, res) {
        try {
            const { query, searchType = 'content', limit = 10 } = req.query;

            if (!query) {
                return res.status(400).json({ error: 'Search query is required' });
            }

            const searchOptions = {
                limit: parseInt(limit),
                searchType,
                minDenseScore: 0.2
            };

            const results = await semanticSearchService.searchBlogs(query, searchOptions);
            
            if (results === null) {
                // Fallback to MongoDB text search
                const formattedResults = await lexicalSearch(query, limit);
                res.setHeader('X-Search-Mode', 'fallback');
                return res.json(formattedResults);
            }

            // Format results with consistent structure
            const formattedResults = results.map(result => ({
                id: result.id,
                title: result.title,
                snippet: result.snippet,
                score: result.score,
                author: result.author
            }));
            
            res.setHeader('X-Search-Mode', 'semantic');
            res.json(formattedResults);
        } catch (error) {
            logger.error({ err: error }, 'Error in blog search');
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async askBlogs(req, res) {
        try {
            const { query, detailLevel = 'brief', limit = 5 } = req.body;

            if (!query) {
                return res.status(400).json({ error: 'Question query is required' });
            }

            // 1. Fetch relevant snippets via Semantic Search
            const searchOptions = {
                limit: parseInt(limit),
                searchType: 'content',
                minDenseScore: 0.1
            };
            const results = (await semanticSearchService.searchBlogs(query, searchOptions))
                ?? await lexicalSearch(query, limit);

            const sources = results.map(result => ({
                id: result.id,
                title: result.title,
                snippet: result.snippet,
                author: result.author
            }));

            // 2. Generate RAG Answer
            let answer = "I couldn't find any relevant information.";
            let generationId = null;
            if (sources.length > 0) {
                const ragResponse = await llmService.generateRagAnswer(query, sources, detailLevel);
                answer = ragResponse.answer || ragResponse; // Fallback in case it's a string
                generationId = ragResponse.generationId || null;
            }

            res.json({
                answer,
                sources,
                generationId
            });
        } catch (error) {
            logger.error({ err: error }, 'Error in askBlogs');
            res.status(500).json({ error: 'Internal server error while generating answer' });
        }
    }

    async submitFeedback(req, res) {
        try {
            const { generationId, feedbackScore, feedbackText } = req.body;
            if (!generationId || !feedbackScore) {
                return res.status(400).json({ error: 'generationId and feedbackScore are required' });
            }
            const logId = await monitoringService.logFeedback(generationId, feedbackScore, feedbackText);
            if (logId) {
                res.json({ message: 'Feedback submitted successfully', logId });
            } else {
                res.status(500).json({ error: 'Failed to submit feedback' });
            }
        } catch (error) {
            logger.error({ err: error }, 'Error in submitFeedback');
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new BlogSearchController();
