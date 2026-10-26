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
const config = require('../src/config');
const logger = require('../src/utils/logger');
const validate = require('../middlewares/validate');
const schemas = require('../validation/schemas');
const { llmLimiter } = require('../middlewares/rateLimits');

connectDB();

mongoose.connection.once('open', () => {
    logger.info('Connected to MongoDB');
})

//Endpoints

// Search and Retrieval endpoints (specific routes first)
blogrouter.get('/search', llmLimiter, validate(schemas.searchQuery, 'query'), blogSearchController.searchBlogs);
blogrouter.post('/ask', llmLimiter, validate(schemas.ask), blogSearchController.askBlogs);
blogrouter.post('/ask/feedback', validate(schemas.feedback), blogSearchController.submitFeedback);
blogrouter.get('/getid', blogCrudController.getBlogIdByTitleAuthor);
blogrouter.post('/semanticSearchbyTitle', llmLimiter, validate(schemas.semanticTitle), require('../controllers/blogController').semanticSearchbyTitle);
blogrouter.post('/retrieve', validate(schemas.retrieve), blogRetrievalController.retrieveBlogsByTitle);

// Summarization endpoints
blogrouter.post('/summarize', llmLimiter, validate(schemas.summarize), blogController.summarize);
blogrouter.get('/summarize/status/:jobId', blogController.summarizeStatus);

// CRUD endpoints (generic routes last)
blogrouter.get('/', blogCrudController.getAllBlogs);
const createGuards = config.authRequiredWrites ? [authenticateToken] : [];
blogrouter.post('/', ...createGuards, validate(schemas.createBlog), blogCrudController.createBlog);
blogrouter.get('/:id', blogCrudController.getBlogById);
blogrouter.put('/:id', authenticateToken, validate(schemas.updateBlog), blogCrudController.updateBlog);
blogrouter.delete('/:id', authenticateToken, blogCrudController.deleteBlog);
blogrouter.post('/:id/comments', authenticateToken, validate(schemas.comment), blogCrudController.addComment);
blogrouter.post('/:id/comments/:commentId/replies', authenticateToken, validate(schemas.reply), blogCrudController.addReply);
blogrouter.put('/:id/like', authenticateToken, blogCrudController.likeBlog);

module.exports = blogrouter;

