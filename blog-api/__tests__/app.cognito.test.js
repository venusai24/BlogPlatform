const request = require('supertest');

const mockVerify = jest.fn();

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: (...args) => mockVerify(...args) })) }
}));
jest.mock('../model/User', () => {
  const User = jest.fn();
  User.findOne = jest.fn().mockResolvedValue(null);
  User.findById = jest.fn();
  return User;
});
jest.mock('../model/BlogContent', () => {
  const BlogContent = jest.fn().mockImplementation(doc => ({
    ...doc,
    _id: { toString: () => '64b7f0c2a1b2c3d4e5f60718' },
    save: jest.fn().mockResolvedValue()
  }));
  BlogContent.find = jest.fn().mockResolvedValue([]);
  return BlogContent;
});
jest.mock('../services/semanticSearchService');
jest.mock('../services/qdrantService', () => ({ initQdrant: jest.fn(), getQdrantClient: jest.fn() }));
jest.mock('../services/redisClient', () => ({ ping: jest.fn(), isReady: true, isOpen: true, get: jest.fn(), set: jest.fn(), connect: jest.fn(), quit: jest.fn() }));
jest.mock('../services/llmService', () => ({ generateRagAnswer: jest.fn(), transformQuery: jest.fn() }));

function loadApp(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    let loaded;
    jest.isolateModules(() => {
      loaded = { app: require('../app'), BlogContent: require('../model/BlogContent'), User: require('../model/User') };
    });
    return loaded;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const COGNITO = { AUTH_PROVIDER: 'cognito', COGNITO_USER_POOL_ID: 'ap-south-1_abc123', COGNITO_CLIENT_ID: 'client-1' };

describe('AUTH_PROVIDER=cognito', () => {
  beforeEach(() => {
    mockVerify.mockReset().mockResolvedValue({ sub: 'sub-123', username: 'alice' });
  });

  it('POST /auth/login returns 410: sign-in is handled by Cognito', async () => {
    const { app, User } = loadApp(COGNITO);

    const res = await request(app).post('/auth/login').send({ username: 'alice', password: 'whatever-pw' });

    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/Cognito/);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('POST /auth/register returns 410', async () => {
    const { app } = loadApp(COGNITO);

    const res = await request(app).post('/auth/register').send({ username: 'alice', password: 'whatever-pw' });

    expect(res.status).toBe(410);
  });

  it('GET /auth/me returns the token username without touching Mongo', async () => {
    const { app, User } = loadApp(COGNITO);

    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer good.token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'alice', userId: 'sub-123' });
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('GET /auth/me returns 401 without a token', async () => {
    const { app } = loadApp(COGNITO);
    expect((await request(app).get('/auth/me')).status).toBe(401);
  });

  it('write routes accept the Cognito token and use its username as the author', async () => {
    const { app, BlogContent } = loadApp(COGNITO);

    const res = await request(app)
      .post('/blogs')
      .set('Authorization', 'Bearer good.token')
      .send({ title: 'T', content: 'C', author: 'mallory' });

    expect(res.status).toBe(201);
    expect(BlogContent).toHaveBeenCalledWith(expect.objectContaining({ author: 'alice' }));
  });

  it('write routes reject a token Cognito does not accept', async () => {
    mockVerify.mockRejectedValue(new Error('expired'));
    const { app } = loadApp(COGNITO);

    const res = await request(app).post('/blogs').set('Authorization', 'Bearer bad').send({ title: 'T', content: 'C' });

    expect(res.status).toBe(403);
  });

  it('the home-grown JWT is not accepted in Cognito mode', async () => {
    mockVerify.mockRejectedValue(new Error('not a cognito token'));
    const { app } = loadApp(COGNITO);
    const { tokenFor } = require('../test/helpers/auth');

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${tokenFor('alice')}`);

    expect(res.status).toBe(403);
  });

  it('the default provider is unchanged: login still goes through the app', async () => {
    const { app, User } = loadApp({ AUTH_PROVIDER: undefined });

    const res = await request(app).post('/auth/login').send({ username: 'alice', password: 'whatever-pw' });

    expect(res.status).not.toBe(410);
    expect(User.findOne).toHaveBeenCalled();
  });
});
