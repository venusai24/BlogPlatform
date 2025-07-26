const semanticSearchService = require('../services/semanticSearchService');

class BlogSearchController {
    async searchBlogs(req, res) {
        try {
            const { query, searchType = 'hybrid', limit = 10 } = req.query;
            const userId = req.user.id; // Get authenticated user's ID

            if (!query) {
                return res.status(400).json({ error: 'Search query is required' });
            }

            const searchOptions = {
                limit: parseInt(limit),
                searchType,
                minScore: 0.3, // Lowered threshold for better recall
                userId // Pass user ID for potential personalization
            };

            const results = await semanticSearchService.searchBlogs(query, searchOptions);
            
            // Format results with consistent structure
            const formattedResults = results.map(result => ({
                id: result.id,
                title: result.title,
                snippet: result.snippet,
                score: result.score,
                author: result.author
            }));
            
            res.json(formattedResults);
        } catch (error) {
            console.error('Error in blog search:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new BlogSearchController();
