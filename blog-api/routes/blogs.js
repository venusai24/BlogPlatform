const express = require('express');
const blogrouter = express.Router();
const mongoose = require('mongoose');
require("dotenv").config();
const connectDB = require('../config/dbConn');
const blogController = require('../controllers/blogController');
const blogCrudController = require('../controllers/blogCrudController');
const { preprocessText, adaptiveChunkText } = require('../utils/textUtils');
const authenticateToken = require('../middlewares/authMiddleware');
const blogRetrievalController = require('../controllers/blogRetrievalController');

connectDB();

mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB');
})

//Endpoints

// CRUD endpoints
blogrouter.post('/', authenticateToken, blogCrudController.createBlog);
blogrouter.get('/', blogCrudController.getAllBlogs);
blogrouter.get('/getid', blogCrudController.getBlogIdByTitleAuthor);
blogrouter.get('/:id', blogCrudController.getBlogById);
blogrouter.put('/:id', authenticateToken, blogCrudController.updateBlog);
blogrouter.delete('/:id', authenticateToken, blogCrudController.deleteBlog);

blogrouter.post('/retrieve', blogRetrievalController.retrieveBlogsByTitle);

// Modularized endpoints
blogrouter.post('/summarize', blogController.summarize);
blogrouter.get('/summarize/status/:jobId', blogController.summarizeStatus);
blogrouter.post('/semantic-search', blogController.semanticSearch);

// TODO: Move the following endpoints to controllers for full modularity
// blogrouter.post("/summary", ...)
// blogrouter.get(":id", ...)
// blogrouter.post("/retrieve/author", ...)
// blogrouter.post("/generate-embeddings", ...)
// blogrouter.post("/semantic-search", ...)
// blogrouter.post("/retrieve", ...)

module.exports = blogrouter;

