const { isValidObjectId } = require('mongoose');
const BlogContent = require('../model/BlogContent');
const postWriter = require('../services/postWriter');
const io = require('../socket');
const config = require('../src/config');

exports.createBlog = async (req, res) => {
    const { title, content, summary, tags } = req.body;
    // With auth required, the author is always the authenticated user; a body `author` is ignored.
    const author = config.authRequiredWrites
        ? req.user.username
        : (req.user?.username ?? req.body.author);

    try {
        const newPost = await postWriter.createPost({ title, content, author, summary, tags });
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
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

    if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid blog ID format' });
    }

    try {
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        // Authorization Hardening: Enforce row-level check
        if (!req.user || blog.author !== req.user.username) {
            return res.status(403).json({ message: "Forbidden: You are not the author of this blog post" });
        }

        const changes = {};
        if (title) changes.title = title;
        if (content) changes.content = content;
        if (summary !== undefined) changes.summary = summary;
        if (tags) changes.tags = tags;

        const updated = await postWriter.updatePost(blog, changes);
        res.status(200).json({ message: "Blog post updated successfully", blog: updated });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

exports.deleteBlog = async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid blog ID format' });
    }

    try {
        const blog = await BlogContent.findById(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        // Authorization Hardening: Enforce row-level check
        if (!req.user || blog.author !== req.user.username) {
            return res.status(403).json({ message: "Forbidden: You are not the author of this blog post" });
        }

        await postWriter.deletePost(blog);

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

    if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid blog ID format' });
    }

    if (!comment) {
        return res.status(400).json({ message: "Comment is required" });
    }

    try {
        const blog = await BlogContent.findByIdAndUpdate(
            id,
            { $push: { comments: { user, comment } } },
            { new: true }
        );
        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        io.getIO().emit('new_comment', { blogId: id, comments: blog.comments });

        res.status(201).json({ message: "Comment added", comments: blog.comments });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

exports.likeBlog = async (req, res) => {
    const { id } = req.params;
    const username = req.user ? req.user.username : null;

    if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid blog ID format' });
    }

    if (!username) {
        return res.status(401).json({ message: "You must be logged in to like a post" });
    }

    try {
        const doc = await BlogContent.findById(id).select('author likedBy');
        if (!doc) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        // Rule: Author cannot like their own blog post
        if (doc.author === username) {
            return res.status(400).json({ message: "You cannot like your own blog post" });
        }

        const liked = doc.likedBy.includes(username);
        const action = liked ? 'unliked' : 'liked';

        // Atomic toggle: the filter makes a concurrent duplicate like/unlike a no-op.
        let blog = await BlogContent.findOneAndUpdate(
            liked ? { _id: id, likedBy: username } : { _id: id, likedBy: { $ne: username } },
            liked
                ? { $pull: { likedBy: username }, $inc: { likes: -1 } }
                : { $addToSet: { likedBy: username }, $inc: { likes: 1 } },
            { new: true }
        );

        if (!blog) {
            // A concurrent toggle won the race; report the current state.
            blog = await BlogContent.findById(id).select('likes likedBy');
            if (!blog) {
                return res.status(404).json({ message: "Blog post not found" });
            }
        }

        io.getIO().emit('like_updated', { blogId: id, likes: blog.likes, likedBy: blog.likedBy });

        res.status(200).json({ message: `Blog ${action} successfully`, likes: blog.likes, likedBy: blog.likedBy });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

exports.addReply = async (req, res) => {
    const { id, commentId } = req.params;
    const { reply } = req.body;
    const user = req.user ? req.user.username : 'Anonymous';

    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
        return res.status(400).json({ message: 'Invalid blog ID format' });
    }

    if (!reply) {
        return res.status(400).json({ message: "Reply is required" });
    }

    try {
        const blog = await BlogContent.findOneAndUpdate(
            { _id: id, 'comments._id': commentId },
            { $push: { 'comments.$.replies': { user, reply } } },
            { new: true }
        );
        if (!blog) {
            const postExists = await BlogContent.exists({ _id: id });
            return res.status(404).json({ message: postExists ? "Comment not found" : "Blog post not found" });
        }

        io.getIO().emit('new_comment', { blogId: id, comments: blog.comments });

        res.status(201).json({ message: "Reply added", comments: blog.comments });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};
