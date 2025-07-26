const BlogContent = require('../model/BlogContent');
const semanticSearchService = require('../services/semanticSearchService');

exports.createBlog = async (req, res) => {
    const { title, content, author, summary, tags } = req.body;
    // ... (validation logic is fine)

    try {
        const newPost = new BlogContent({ title, content, author, summary, tags });
        await newPost.save();

        try {
            // FIX: Call the correct service and method, passing the full object
            await semanticSearchService.indexBlogPost(newPost);
            console.log('[BlogCrudController] Blog indexed in Pinecone:', newPost._id);
        } catch (err) {
            console.error('[BlogCrudController] Failed to index blog in Pinecone:', err);
        }
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    } catch (error) {
        // ... (error handling is fine)
        res.status(500).json({ message: "Server Error", error: error.message });
    }
};


exports.getAllBlogs = async (req, res) => {
    try {
        const blogs = await BlogContent.find();
        res.status(200).json(blogs);
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

exports.getBlogById = async (req, res) => {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ message: "Invalid blog ID format" });
    }

    try {
        const blog = await BlogContent.findById(id).select("title author content summary tags likes comments");
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }
        res.status(200).json({
            message: "Blog post retrieved successfully",
            blog
        });
    } catch (error) {
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

        if (title) blog.title = title;
        if (content) blog.content = content;
        if (summary !== undefined) blog.summary = summary;
        if (tags) blog.tags = tags;

        await blog.save();

        try {
            // FIX: Call the correct service and method to re-index
            await semanticSearchService.indexBlogPost(blog);
            console.log('[BlogCrudController] Blog re-indexed in Pinecone:', id);
        } catch (err) {
            console.error('[BlogCrudController] Failed to re-index blog in Pinecone:', err);
        }
        res.status(200).json({ message: "Blog post updated successfully", blog });
    } catch (error) {
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

        try {
            // CHANGED: We can now simply pass the ID, as the service uses a metadata filter.
            await semanticSearchService.deleteBlogEmbeddings(id);
            console.log('[BlogCrudController] Blog embeddings deleted from Pinecone:', id);
        } catch (err) {
            console.error('[BlogCrudController] Failed to delete blog embeddings from Pinecone:', err);
        }

        res.status(200).json({ message: "Blog post deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};