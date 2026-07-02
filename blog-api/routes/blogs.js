const express = require('express');
const blogrouter = express.Router();
const mongoose = require('mongoose');
require("dotenv").config();
const connectDB = require('../config/dbConn');
const blogController = require('../controllers/blogController');
const blogCrudController = require('../controllers/blogCrudController');
const authenticateToken = require('../middlewares/authMiddleware');
const blogRetrievalController = require('../controllers/blogRetrievalController');
const blogSearchController = require('../controllers/blogSearchController');

connectDB();

mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB');
})

//Endpoints

// Search and Retrieval endpoints (specific routes first)
blogrouter.get('/search', blogSearchController.searchBlogs);
blogrouter.post('/ask', blogSearchController.askBlogs);
blogrouter.get('/getid', blogCrudController.getBlogIdByTitleAuthor);
blogrouter.post('/semanticSearchbyTitle', require('../controllers/blogController').semanticSearchbyTitle);
blogrouter.post('/retrieve', blogRetrievalController.retrieveBlogsByTitle);

// Summarization endpoints
blogrouter.post('/summarize', blogController.summarize);
blogrouter.get('/summarize/status/:jobId', blogController.summarizeStatus);

// CRUD endpoints (generic routes last)
blogrouter.get('/', blogCrudController.getAllBlogs);
blogrouter.post('/', blogCrudController.createBlog);
blogrouter.get('/:id', blogCrudController.getBlogById);
blogrouter.put('/:id', authenticateToken, blogCrudController.updateBlog);
blogrouter.delete('/:id', authenticateToken, blogCrudController.deleteBlog);
blogrouter.post('/:id/comments', authenticateToken, blogCrudController.addComment);
blogrouter.post('/:id/comments/:commentId/replies', authenticateToken, blogCrudController.addReply);
blogrouter.put('/:id/like', authenticateToken, blogCrudController.likeBlog);

module.exports = blogrouter;

