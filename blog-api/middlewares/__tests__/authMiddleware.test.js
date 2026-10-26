const jwt = require('jsonwebtoken');

const SECRET = 'testsecret';
const CLAIMS = { issuer: 'blogplatform-api', audience: 'blogplatform-web' };
const payload = { userId: 'u1', username: 'alice' };

const goodToken = () => jwt.sign(payload, SECRET, { ...CLAIMS, algorithm: 'HS256', expiresIn: '1h' });

// Runs the middleware and resolves once it either calls next() or responds.
function run(middleware, token) {
  return new Promise((resolve) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = {
      status: jest.fn(function () { return this; }),
      json: jest.fn(() => resolve({ req, res, next })),
    };
    const next = jest.fn(() => resolve({ req, res, next }));
    middleware(req, res, next);
  });
}

describe('authenticateToken', () => {
  const authenticateToken = require('../authMiddleware');

  it('accepts a token with the expected claims', async () => {
    const { req, next } = await run(authenticateToken, goodToken());
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.username).toBe('alice');
  });

  it('rejects a token without issuer/audience', async () => {
    const { res, next } = await run(authenticateToken, jwt.sign(payload, SECRET, { algorithm: 'HS256' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects an HS512-signed token', async () => {
    const token = jwt.sign(payload, SECRET, { ...CLAIMS, algorithm: 'HS512' });
    const { res, next } = await run(authenticateToken, token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 401 when no token is provided', async () => {
    const { res } = await run(authenticateToken, null);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a claimless token when JWT_REQUIRE_CLAIMS=false', async () => {
    process.env.JWT_REQUIRE_CLAIMS = 'false';
    try {
      let relaxed;
      jest.isolateModules(() => {
        relaxed = require('../authMiddleware');
      });
      const { req, next } = await run(relaxed, jwt.sign(payload, SECRET, { algorithm: 'HS256' }));
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.username).toBe('alice');

      // The algorithm is still pinned when claims are not required.
      const hs512 = await run(relaxed, jwt.sign(payload, SECRET, { algorithm: 'HS512' }));
      expect(hs512.res.status).toHaveBeenCalledWith(403);
    } finally {
      delete process.env.JWT_REQUIRE_CLAIMS;
    }
  });
});
