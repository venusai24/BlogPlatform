const { CognitoJwtVerifier } = require('aws-jwt-verify');
const config = require('../src/config');
const logger = require('../src/utils/logger');

// Verifies Cognito *access* tokens (signature via the pool's JWKS, expiry, client and token use).
// Sets the same req.user shape as the home-grown JWT middleware, so controllers do not care which
// provider issued the token: { userId, username }.
const verifier = CognitoJwtVerifier.create({
    userPoolId: config.cognitoUserPoolId,
    tokenUse: 'access',
    clientId: config.cognitoClientId
});

async function authenticateCognitoToken(req, res, next) {
    const header = req.headers['authorization'];
    const match = header && /^Bearer (.+)$/.exec(header);
    if (!match) return res.status(401).json({ message: 'No token provided' });

    try {
        const payload = await verifier.verify(match[1]);
        req.user = { userId: payload.sub, username: payload.username };
        next();
    } catch (err) {
        // Say why in the log, not in the response.
        logger.debug({ err }, 'Cognito token rejected');
        res.status(403).json({ message: 'Invalid token' });
    }
}

module.exports = authenticateCognitoToken;
