const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require("dotenv").config();
const connectDB = require('./config/dbConn');
const BlogContent = require('../routes/model/BlogContent');
//Connect to MongoDB
connectDB();

mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB');
})

//Endpoints

//1)Add a new Blog post
router.post("/", async(req, res) => {
    const { title, content, author, tags } = req.body;

    try{
        const newPost = new BlogContent({ title, content, author, tags });
        await newPost.save();
        res.status(201).json({ message: "Blog post created successfully", blog: newPost });
    }catch(error){
        console.error(error);
        res.status(500).json({message:"Server Error"});
    }
});

//2)Retrieve all blog posts
router.get("/", async(req, res) => {
    try {
        const blogs = await Blog.find();
        res.status(200).json(blogs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

