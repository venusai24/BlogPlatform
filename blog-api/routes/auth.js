const express = require('express');
const authrouter = express.Router();
const authController = require('../controllers/authController');


// Modularized auth endpoints
authrouter.post('/register', authController.register);
authrouter.post('/login', authController.login);

module.exports = authrouter;
