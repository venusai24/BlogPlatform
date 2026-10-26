
const BlogContent = require('../model/BlogContent');
const { calculateTitleScore } = require('../utils/searchUtils');
const logger = require('../src/utils/logger');

exports.retrieveBlogsByTitle = async (req, res) => {
    const { titleQuery } = req.body;

    if (!titleQuery) {
        return res.status(400).json({ message: "Title query is required" });
    }

    try {
        // Fetch only necessary fields for performance
        const blogs = await BlogContent.find({}, "_id title author");

        // Calculate scores and filter/sort results
        const results = blogs
            .map((blog) => ({
                id: blog._id,
                title: blog.title,
                author: blog.author,
                score: calculateTitleScore(titleQuery, blog.title),
            }))
            .filter((result) => result.score !== Infinity && !isNaN(result.score))
            .sort((a, b) => a.score - b.score); // Lower score = better match

        logger.debug({ scanned: blogs.length, matched: results.length }, 'Title retrieval');

        // Format response
        res.status(200).json(results.map((result) => ({
            author: result.author,
            _id: result.id,
            title: result.title,
        })));

    } catch (error) {
        logger.error({ err: error }, 'Error retrieving blogs by title');
        res.status(500).json({ message: "Server error" });
    }
};
