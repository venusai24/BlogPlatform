const jwt = require('jsonwebtoken');
const config = require('../src/config');

const verifyOptions = config.jwtRequireClaims
    ? { algorithms: ['HS256'], issuer: 'blogplatform-api', audience: 'blogplatform-web' }
    : { algorithms: ['HS256'] };

function authenticateAppToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    jwt.verify(token, config.jwtSecret, verifyOptions, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
}

// AUTH_PROVIDER picks who issued the token. Every route imports this one module, so switching providers
// needs no route changes. The Cognito verifier is only loaded in Cognito mode.
module.exports = config.authProvider === 'cognito'
    ? require('./cognitoAuth')
    : authenticateAppToken;
