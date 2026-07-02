const BlogContent = require('../model/BlogContent');
const semanticSearchService = require('../services/semanticSearchService');
const io = require('../socket');

exports.createBlog = async (req, res) => {
    const { title, content, author, summary, tags } = req.body;

    try {
        const newPost = new BlogContent({ title, content, author, summary, tags });
        await newPost.save();

        try {
            // FIX: Call the correct service and method, passing the full object
            await semanticSearchService.indexBlogPost(newPost);
        } catch (err) {
        }
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    } catch (error) {
        res.status(500).json({ message: "Server Error", error: error.message });
    }
};


exports.getAllBlogs = async (req, res) => {
    try {
        const query = {};
        if (req.query.author) {
            query.author = req.query.author;
        }
        const blogs = await BlogContent.find(query);
        
        // Sort by formula: 1.5 * no of comments + no of likes
        blogs.sort((a, b) => {
            const scoreA = 1.5 * (a.comments?.length || 0) + (a.likes || 0);
            const scoreB = 1.5 * (b.comments?.length || 0) + (b.likes || 0);
            return scoreB - scoreA;
        });

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

        // Authorization Hardening: Enforce row-level check
        if (req.user && blog.author !== req.user.username) {
            return res.status(403).json({ message: "Forbidden: You are not the author of this blog post" });
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
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        // Authorization Hardening: Enforce row-level check
        if (req.user && blog.author !== req.user.username) {
            return res.status(403).json({ message: "Forbidden: You are not the author of this blog post" });
        }

        const deletedBlog = await BlogContent.findByIdAndDelete(id);

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

exports.addComment = async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body;
    // Assuming the authMiddleware adds req.user
    const user = req.user ? req.user.username : 'Anonymous';

    if (!comment) {
        return res.status(400).json({ message: "Comment is required" });
    }

    try {
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        blog.comments.push({ user, comment });
        await blog.save();

        io.getIO().emit('new_comment', { blogId: id, comments: blog.comments });

        res.status(201).json({ message: "Comment added", comments: blog.comments });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.likeBlog = async (req, res) => {
    const { id } = req.params;
    const username = req.user ? req.user.username : null;

    if (!username) {
        return res.status(401).json({ message: "You must be logged in to like a post" });
    }

    try {
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        // Rule: Author cannot like their own blog post
        if (blog.author === username) {
            return res.status(400).json({ message: "You cannot like your own blog post" });
        }

        const likedIndex = blog.likedBy.indexOf(username);
        let action = 'liked';

        if (likedIndex > -1) {
            // Already liked, so unlike it
            blog.likedBy.splice(likedIndex, 1);
            blog.likes = Math.max((blog.likes || 1) - 1, 0);
            action = 'unliked';
        } else {
            // Like it
            blog.likedBy.push(username);
            blog.likes = (blog.likes || 0) + 1;
        }

        await blog.save();

        io.getIO().emit('like_updated', { blogId: id, likes: blog.likes, likedBy: blog.likedBy });

        res.status(200).json({ message: `Blog ${action} successfully`, likes: blog.likes, likedBy: blog.likedBy });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.addReply = async (req, res) => {
    const { id, commentId } = req.params;
    const { reply } = req.body;
    const user = req.user ? req.user.username : 'Anonymous';

    if (!reply) {
        return res.status(400).json({ message: "Reply is required" });
    }

    try {
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        const comment = blog.comments.id(commentId);
        if (!comment) {
            return res.status(404).json({ message: "Comment not found" });
        }

        comment.replies.push({ user, reply });
        await blog.save();

        io.getIO().emit('new_comment', { blogId: id, comments: blog.comments });

        res.status(201).json({ message: "Reply added", comments: blog.comments });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};