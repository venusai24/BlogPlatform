const jwt = require('jsonwebtoken');

// Signs a token the API accepts: same secret and claims as controllers/authController.js.
function tokenFor(username) {
  return jwt.sign({ userId: `u-${username}`, username }, process.env.JWT_SECRET || 'testsecret', {
    expiresIn: '1h',
    issuer: 'blogplatform-api',
    audience: 'blogplatform-web',
    algorithm: 'HS256'
  });
}

module.exports = { tokenFor };
