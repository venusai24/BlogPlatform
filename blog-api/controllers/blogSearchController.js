const semanticSearchService = require('../services/semanticSearchService');

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
            console.log(results);
            
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
}

module.exports = new BlogSearchController();
