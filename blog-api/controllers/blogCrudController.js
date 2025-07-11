const BlogContent = require('../model/BlogContent');
const { generateEmbedding } = require('../services/embeddingService');

exports.createBlog = async (req, res) => {
    const { title, content, author, summary } = req.body;
    try {
        const titleEmbedding = await generateEmbedding(title);
        const contentEmbedding = await generateEmbedding(content);
        const summaryEmbedding = summary ? await generateEmbedding(summary) : [];

        // Debug logs
        console.log('title:', title);
        console.log('titleEmbedding:', titleEmbedding);
        console.log('content:', content);
        console.log('contentEmbedding:', contentEmbedding);
        console.log('summary:', summary);
        console.log('summaryEmbedding:', summaryEmbedding);
        console.log('typeof titleEmbedding:', typeof titleEmbedding, Array.isArray(titleEmbedding));
        console.log('typeof contentEmbedding:', typeof contentEmbedding, Array.isArray(contentEmbedding));

        // Validate embeddings
        const isValidEmbedding = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === "number" && !isNaN(x));
        if (!isValidEmbedding(titleEmbedding) || !isValidEmbedding(contentEmbedding)) {
            console.error('Invalid embedding detected:', { titleEmbedding, contentEmbedding });
            return res.status(500).json({ message: "Embedding generation failed. Please try again." });
        }

        const newPost = new BlogContent({
            title,
            content,
            author,
            summary,
            titleEmbedding,
            contentEmbedding,
            summaryEmbedding
        });
        await newPost.save();
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "A blog with this title already exists for the same author" });
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
    const { title, content, tags } = req.body;
    try {
        const updatedBlog = await BlogContent.findByIdAndUpdate(
            id,
            { title, content, tags },
            { new: true, runValidators: true }
        );
        if (!updatedBlog) {
            return res.status(404).json({ message: "Blog post not found" });
        }
        res.status(200).json({ message: "Blog post updated successfully", blog: updatedBlog });
    } catch (error) {
        console.error(error);
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
