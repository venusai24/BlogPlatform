const express = require('express');
const authrouter = express.Router();
const authController = require('../controllers/authController');

const config = require('../src/config');
const authenticateToken = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const schemas = require('../validation/schemas');
const { authLimiter } = require('../middlewares/rateLimits');

if (config.authProvider === 'cognito') {
    // Cognito managed login owns sign-up and sign-in; the API only verifies the tokens it issues.
    const gone = (req, res) => res.status(410).json({ message: 'Sign-in is handled by Cognito managed login' });
    authrouter.post('/register', gone);
    authrouter.post('/login', gone);
    authrouter.get('/me', authenticateToken, (req, res) => {
        res.status(200).json({ username: req.user.username, userId: req.user.userId });
    });
} else {
    // Modularized auth endpoints
    authrouter.post('/register', authLimiter, validate(schemas.register), authController.register);
    authrouter.post('/login', authLimiter, validate(schemas.login), authController.login);
    authrouter.get('/me', authenticateToken, authController.getMe);
}

module.exports = authrouter;
