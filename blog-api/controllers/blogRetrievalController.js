const BlogContent = require('../model/BlogContent');
const { calculateTitleScore } = require('../utils/searchUtils');

exports.retrieveBlogsByTitle = async (req, res) => {
    console.log("=== BLOG RETRIEVAL DEBUG START ===");
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    
    const { titleQuery } = req.body;
    
    console.log("Extracted titleQuery:", titleQuery);
    console.log("titleQuery type:", typeof titleQuery);
    
    if (!titleQuery) {
        console.error("Missing titleQuery in request");
        return res.status(400).json({ message: "Title query is required" });
    }
    
    try {
        console.log("Fetching blogs from database...");
        
        // Fetch only necessary fields for performance
        const blogs = await BlogContent.find({}, "_id title author");
        
        console.log(`Found ${blogs.length} blogs in database`);
        console.log("Sample blogs:", blogs.slice(0, 3).map(b => ({ id: b._id, title: b.title, author: b.author })));
        
        // Calculate scores and filter/sort results
        console.log("Calculating title scores...");
        const results = blogs
            .map((blog) => {
                const score = calculateTitleScore(titleQuery, blog.title);
                return {
                    id: blog._id,
                    title: blog.title,
                    author: blog.author,
                    score: score,
                };
            })
            .filter((result) => {
                const isValid = result.score !== Infinity && !isNaN(result.score);
                if (!isValid) {
                    console.log(`Filtered out blog with invalid score: ${result.title} (score: ${result.score})`);
                }
                return isValid;
            })
            .sort((a, b) => a.score - b.score); // Lower score = better match
        
        console.log(`Processed ${results.length} valid results`);
        console.log("Top 5 results:", results.slice(0, 5).map(r => ({ 
            title: r.title, 
            author: r.author, 
            score: r.score 
        })));
        
        // Format response
        const formattedResults = results.map((result) => ({
            author: result.author,
            _id: result.id,
            title: result.title,
        }));
        
        console.log("=== BLOG RETRIEVAL DEBUG END ===");
        res.status(200).json(formattedResults);
        
    } catch (error) {
        console.error("=== BLOG RETRIEVAL ERROR ===");
        console.error("Error details:", error);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
        
        res.status(500).json({ message: "Server error", error: error.message });
    }
};