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

// CRUD endpoints

blogrouter.post('/', blogCrudController.createBlog);
blogrouter.get('/', blogCrudController.getAllBlogs);
blogrouter.get('/getid', blogCrudController.getBlogIdByTitleAuthor);
blogrouter.post('/retrieve', blogRetrievalController.retrieveBlogsByTitle);
blogrouter.post('/summarize', blogController.summarize);
blogrouter.get('/summarize/status/:jobId', blogController.summarizeStatus);
blogrouter.post('/semanticSearchbyTitle', blogController.semanticSearchbyTitle);
blogrouter.get('/search', blogSearchController.searchBlogs);
blogrouter.get('/:id', blogCrudController.getBlogById);
blogrouter.put('/:id', blogCrudController.updateBlog);
blogrouter.delete('/:id', blogCrudController.deleteBlog);

module.exports = blogrouter;

