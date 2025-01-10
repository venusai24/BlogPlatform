const express = require('express');
const blogrouter = express.Router();
const mongoose = require('mongoose');
require("dotenv").config();
const connectDB = require('./config/dbConn');
const BlogContent = require('./model/BlogContent');
const summarizeText = require('./summarize');
//Connect to MongoDB
connectDB();

mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB');
})

//Endpoints

//1)Add a new Blog post
blogrouter.post("/", async (req, res) => {
    const { title, content, author, summary } = req.body;

    try {
        const newPost = new BlogContent({ title, content, author, summary });
        await newPost.save();
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "A blog with this title already exists for the same author" });
        }
        console.error(error);
        res.status(500).json({ message: "Server Error" });
    }
});


//2)Retrieve all blog posts
blogrouter.get("/", async(req, res) => {
    try {
        const blogs = await BlogContent.find();
        res.status(200).json(blogs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

//3)Get Blog _id by Title and Author
blogrouter.get("/getid", async (req, res) => {
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
});

//4.Update a blog post
blogrouter.put("/:id", async (req, res) => {
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
});

// 5. Delete a blog post
blogrouter.delete("/:id", async (req, res) => {
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
});

const calculateTitleScore = (query, title) => {
    const normalize = (str) => str.replace(/\s+/g, "").toLowerCase();

    const normalizedQuery = normalize(query);
    const normalizedTitle = normalize(title);

    if (!normalizedTitle.includes(normalizedQuery)) {
        return Infinity; 
    }

    let score = 0;

    
    const charDifference = Math.abs(query.length - title.length);
    score += charDifference * 10;

    
    for (let i = 0; i < Math.min(query.length, title.length); i++) {
        if (query[i].toLowerCase() === title[i].toLowerCase() && query[i] !== title[i]) {
            score += 2; 
        }
    }

    
    const querySpaces = query.match(/\s/g) || [];
    const titleSpaces = title.match(/\s/g) || [];
    const spaceDifference = Math.abs(querySpaces.length - titleSpaces.length);
    score += spaceDifference * 5;

    
    const hasExtraSpaces = title.includes(" ") && !query.includes(" ");
    if (hasExtraSpaces) {
        score += 3;
    }

    return score;
};

blogrouter.post("/retrieve", async (req, res) => {
    const { titleQuery } = req.body;

    if (!titleQuery) {
        return res.status(400).json({ message: "Title query is required" });
    }

    try {
        
        const blogs = await BlogContent.find({}, "_id title author");

        
        const results = blogs
    .map((blog) => ({
        id: blog._id,
        title: blog.title,
        author: blog.author, 
        score: calculateTitleScore(titleQuery, blog.title),
    }))
    .filter((result) => result.score !== Infinity) 
    .sort((a, b) => a.score - b.score); 

    res.status(200).json(
        results.map((result) => ({
            author: result.author,
            _id: result.id,
            title: result.title,
        }))
    );
    } catch (error) {
        console.error("Error retrieving blogs:", error);
        res.status(500).json({ message: "Server error" });
    }
});

blogrouter.post("/summarize", async(req, res) => {
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ message: "Content is required" });
    }
    summarizeText(content, "llama-3.3-70b-versatile").then((finalSummary) => {
        return res.status(200).json({
            message: "Summarized successfully",
            summary: finalSummary
        });
      });
})

blogrouter.post("/summary", async (req, res) => {
    const { _id, summary } = req.body;
  
    if (!_id || !summary) {
      return res.status(400).json({ message: "Blog ID and summary are required." });
    }
  
    try {
      // Find the blog by ID and update the summary field
      const updatedBlog = await BlogContent.findByIdAndUpdate(
        _id,
        { summary },
        { new: true, runValidators: true } // Return the updated document
      );
  
      if (!updatedBlog) {
        return res.status(404).json({ message: "Blog not found" });
      }
  
      res.status(200).json({
        message: "Summary updated successfully",
        blog: updatedBlog,
      });
    } catch (error) {
      console.error("Error updating summary:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  

blogrouter.get("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const blog = await BlogContent.findById(id).select("title author content"); // Select only the required fields

        if (!blog) {
            return res.status(404).json({ message: "Blog post not found" });
        }

        res.status(200).json({ 
            message: "Blog post retrieved successfully", 
            blog: { 
                title: blog.title, 
                author: blog.author, 
                content: blog.content 
            } 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = blogrouter;