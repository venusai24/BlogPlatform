const semanticSearchService = require('../services/semanticSearchService');
const llmService = require('../services/llmService');

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
                minScore: 0.2 // Lowered threshold for better recall
            };

            const results = await semanticSearchService.searchBlogs(query, searchOptions);
            
            // Format results with consistent structure
            const formattedResults = results.map(result => ({
                id: result.id,
                title: result.title,
                snippet: result.snippet,
                score: result.score,
                author: result.author // Include author in response
            }));
            
            res.json(formattedResults);
        } catch (error) {
            console.error('Error in blog search:', error);
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
                minScore: 0.1 
            };
            const results = await semanticSearchService.searchBlogs(query, searchOptions);
            
            const sources = results.map(result => ({
                id: result.id,
                title: result.title,
                snippet: result.snippet,
                author: result.author
            }));

            // 2. Generate RAG Answer
            let answer = "I couldn't find any relevant information.";
            if (sources.length > 0) {
                answer = await llmService.generateRagAnswer(query, sources, detailLevel);
            }

            res.json({
                answer,
                sources
            });
        } catch (error) {
            console.error('Error in askBlogs:', error);
            res.status(500).json({ error: 'Internal server error while generating answer' });
        }
    }
}

module.exports = new BlogSearchController();
