const express = require('express');
const authrouter = express.Router();
const authController = require('../controllers/authController');


const authenticateToken = require('../middlewares/authMiddleware');

// Modularized auth endpoints
authrouter.post('/register', authController.register);
authrouter.post('/login', authController.login);
authrouter.get('/me', authenticateToken, authController.getMe);

module.exports = authrouter;
