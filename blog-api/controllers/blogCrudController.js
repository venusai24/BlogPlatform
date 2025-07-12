const BlogContent = require('../model/BlogContent');
const { generateEmbedding } = require('../services/embeddingService');

exports.createBlog = async (req, res) => {
    console.log("=== BLOG CREATION DEBUG START ===");
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    
    const { title, content, author, summary } = req.body;
    
    // Validate input data
    console.log("Extracted data:");
    console.log("- title:", title, "type:", typeof title);
    console.log("- content:", content, "type:", typeof content);
    console.log("- author:", author, "type:", typeof author);
    console.log("- summary:", summary, "type:", typeof summary);
    
    if (!title || !content || !author) {
        console.error("Missing required fields");
        return res.status(400).json({ message: "Title, content, and author are required" });
    }
    
    try {
        console.log("Generating embeddings...");
        
        // Generate title embedding
        console.log("Generating title embedding for:", title);
        const titleEmbedding = await generateEmbedding(title);
        console.log("Title embedding result:", {
            type: typeof titleEmbedding,
            isArray: Array.isArray(titleEmbedding),
            length: titleEmbedding ? titleEmbedding.length : 'N/A',
            sample: titleEmbedding ? titleEmbedding.slice(0, 5) : 'N/A',
            hasNaN: titleEmbedding ? titleEmbedding.some(isNaN) : 'N/A'
        });
        
        // Generate content embedding
        console.log("Generating content embedding for content length:", content.length);
        const contentEmbedding = await generateEmbedding(content);
        console.log("Content embedding result:", {
            type: typeof contentEmbedding,
            isArray: Array.isArray(contentEmbedding),
            length: contentEmbedding ? contentEmbedding.length : 'N/A',
            sample: contentEmbedding ? contentEmbedding.slice(0, 5) : 'N/A',
            hasNaN: contentEmbedding ? contentEmbedding.some(isNaN) : 'N/A'
        });
        
        // Generate summary embedding if summary exists
        let summaryEmbedding = [];
        if (summary) {
            console.log("Generating summary embedding for:", summary);
            summaryEmbedding = await generateEmbedding(summary);
            console.log("Summary embedding result:", {
                type: typeof summaryEmbedding,
                isArray: Array.isArray(summaryEmbedding),
                length: summaryEmbedding ? summaryEmbedding.length : 'N/A',
                sample: summaryEmbedding ? summaryEmbedding.slice(0, 5) : 'N/A',
                hasNaN: summaryEmbedding ? summaryEmbedding.some(isNaN) : 'N/A'
            });
        } else {
            console.log("No summary provided, using empty array for summaryEmbedding");
        }

        // Debug logs (keeping original ones)
        console.log('title:', title);
        console.log('titleEmbedding:', titleEmbedding);
        console.log('content:', content);
        console.log('contentEmbedding:', contentEmbedding);
        console.log('summary:', summary);
        console.log('summaryEmbedding:', summaryEmbedding);
        console.log('typeof titleEmbedding:', typeof titleEmbedding, Array.isArray(titleEmbedding));
        console.log('typeof contentEmbedding:', typeof contentEmbedding, Array.isArray(contentEmbedding));

        // Validate embeddings
        const isValidEmbedding = (arr) => {
            console.log("Validating embedding:", {
                isArray: Array.isArray(arr),
                length: arr ? arr.length : 'N/A',
                hasValidNumbers: arr ? arr.every((x) => typeof x === "number" && !isNaN(x)) : false
            });
            return Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === "number" && !isNaN(x));
        };
        
        const titleValid = isValidEmbedding(titleEmbedding);
        const contentValid = isValidEmbedding(contentEmbedding);
        
        console.log("Embedding validation results:");
        console.log("- titleEmbedding valid:", titleValid);
        console.log("- contentEmbedding valid:", contentValid);
        
        if (!titleValid || !contentValid) {
            console.error('Invalid embedding detected:', { 
                titleEmbedding: titleEmbedding, 
                contentEmbedding: contentEmbedding,
                titleValid,
                contentValid
            });
            return res.status(500).json({ message: "Embedding generation failed. Please try again." });
        }

        // Create blog post object
        const blogData = {
            title,
            content,
            author,
            summary,
            titleEmbedding,
            contentEmbedding,
            summaryEmbedding
        };
        
        console.log("Creating blog post with data:", {
            title: blogData.title,
            author: blogData.author,
            contentLength: blogData.content.length,
            summaryLength: blogData.summary ? blogData.summary.length : 0,
            titleEmbeddingLength: blogData.titleEmbedding.length,
            contentEmbeddingLength: blogData.contentEmbedding.length,
            summaryEmbeddingLength: blogData.summaryEmbedding.length
        });

        const newPost = new BlogContent(blogData);
        
        console.log("Blog post model created, attempting to save...");
        await newPost.save();
        console.log("Blog post saved successfully with ID:", newPost._id);
        
        console.log("=== BLOG CREATION DEBUG END ===");
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    } catch (error) {
        console.error("=== BLOG CREATION ERROR ===");
        console.error("Error details:", error);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
        
        if (error.code === 11000) {
            console.error("Duplicate key error:", error.keyValue);
            return res.status(400).json({ message: "A blog with this title already exists for the same author" });
        }
        
        // Check for MongoDB validation errors
        if (error.name === 'ValidationError') {
            console.error("MongoDB validation error:", error.errors);
            return res.status(400).json({ 
                message: "Validation error", 
                errors: error.errors 
            });
        }
        
        console.error('Blog creation error:', error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
};

exports.getAllBlogs = async (req, res) => {
    try {
        const blogs = await BlogContent.find();
        res.status(200).json(blogs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// NEW: Get blog by ID
exports.getBlogById = async (req, res) => {
    const { id } = req.params;
    
    // Validate ObjectId format
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ message: "Invalid blog ID format" });
    }
    
    try {
        const blog = await BlogContent.findById(id).select("title author content summary");

        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        res.status(200).json({
            message: "Blog post retrieved successfully",
            blog: {
                title: blog.title,
                author: blog.author,
                content: blog.content,
                summary: blog.summary
            }
        });
    } catch (error) {
        console.error('Error fetching blog by ID:', error);
        res.status(500).json({ message: "Server error" });
    }
};


exports.getBlogIdByTitleAuthor = async (req, res) => {
    const { author, title } = req.query;
    if (!author || !title) {
        return res.status(400).json({ message: "Author and title are required" });
    }
    try {
        const blog = await BlogContent.findOne({ author, title });
        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }
        res.status(200).json({ _id: blog._id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

exports.updateBlog = async (req, res) => {
    const { id } = req.params;
    const { title, content, tags, summary } = req.body;

    try {
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        // Determine if embeddings need to be regenerated
        const updates = {};
        if (title && title !== blog.title) {
            console.log("Title updated. Regenerating title embedding...");
            const titleEmbedding = await generateEmbedding(title);
            updates.titleEmbedding = titleEmbedding;
            updates.title = title;
        }

        if (content && content !== blog.content) {
            console.log("Content updated. Regenerating content embedding...");
            const contentEmbedding = await generateEmbedding(content);
            updates.contentEmbedding = contentEmbedding;
            updates.content = content;
        }

        if (summary !== undefined && summary !== blog.summary) {
            console.log("Summary updated. Regenerating summary embedding...");
            updates.summary = summary;

            if (summary) {
                const summaryEmbedding = await generateEmbedding(summary);
                updates.summaryEmbedding = summaryEmbedding;
            } else {
                updates.summaryEmbedding = [];
            }
        }

        if (tags) {
            updates.tags = tags;
        }

        console.log("Applying updates to blog post:", updates);

        const updatedBlog = await BlogContent.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        res.status(200).json({ message: "Blog post updated successfully", blog: updatedBlog });
    } catch (error) {
        console.error("Error updating blog post:", error);
        res.status(500).json({ message: "Server error" });
    }
};

exports.deleteBlog = async (req, res) => {
    const { id } = req.params;
    try {
        const deletedBlog = await BlogContent.findByIdAndDelete(id);
        if (!deletedBlog) {
            return res.status(404).json({ message: "Blog post not found" });
        }
        res.status(200).json({ message: "Blog post deleted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};