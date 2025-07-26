const semanticSearchService = require('../services/semanticSearchService');

class BlogSearchController {
    async searchBlogs(req, res) {
        try {
            const { query, searchType = 'hybrid', limit = 10 } = req.query;

            if (!query) {
                return res.status(400).json({ error: 'Search query is required' });
            }

            const searchOptions = {
                limit: parseInt(limit),
                searchType,
                minScore: 0.7 // Configurable threshold
            };

            const results = await semanticSearchService.searchBlogs(query, searchOptions);
            res.json(results);
        } catch (error) {
            console.error('Error in blog search:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new BlogSearchController();
