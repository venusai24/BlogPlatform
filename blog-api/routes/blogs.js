const express = require('express');
const blogrouter = express.Router();
const mongoose = require('mongoose');
require("dotenv").config();
const connectDB = require('../config/dbConn');
const blogController = require('../controllers/blogController');
const blogCrudController = require('../controllers/blogCrudController');
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
blogrouter.post('/summarize', blogController.summarize);
blogrouter.get('/summarize/status/:jobId', blogController.summarizeStatus);
blogrouter.post('/semanticSearchbyTitle', blogController.semanticSearchbyTitle);

module.exports = blogrouter;

