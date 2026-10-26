const request = require('supertest');
const { tokenFor } = require('../test/helpers/auth');

jest.mock('../model/User', () => {
    const User = jest.fn().mockImplementation(doc => ({ ...doc, save: jest.fn().mockResolvedValue(doc) }));
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
    BlogContent.findById = jest.fn();
    return BlogContent;
});
jest.mock('../services/semanticSearchService');
jest.mock('../services/qdrantService', () => ({
    initQdrant: jest.fn(),
    getQdrantClient: jest.fn()
}));
jest.mock('../services/redisClient', () => ({
    ping: jest.fn(),
    isReady: true,
    isOpen: true,
    get: jest.fn(),
    set: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn()
}));
jest.mock('../services/llmService', () => ({ generateRagAnswer: jest.fn(), transformQuery: jest.fn() }));

// Load a fresh app (fresh in-memory rate-limit counters, config re-read) with the given env.
function freshApp(env = {}) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k];
        process.env[k] = v;
    }
    try {
        let app;
        let BlogContent;
        jest.isolateModules(() => {
            app = require('../app');
            BlogContent = require('../model/BlogContent');
        });
        return { app, BlogContent };
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

const login = (app) => request(app).post('/auth/login').send({ username: 'alice', password: 'pw' });

describe('app security', () => {
    it('POST /blogs with a 201-char title returns 400', async () => {
        const { app } = freshApp();
        const res = await request(app)
            .post('/blogs')
            .set({ Authorization: `Bearer ${tokenFor('alice')}` })
            .send({ title: 'a'.repeat(201), content: 'c' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid request');
        expect(Array.isArray(res.body.issues)).toBe(true);
    });

    it('GET /blogs/search?query=x&limit=1000 returns 400', async () => {
        const { app } = freshApp();
        const res = await request(app).get('/blogs/search?query=x&limit=1000');
        expect(res.status).toBe(400);
    });

    it('the 11th POST /auth/login in a window returns 429', async () => {
        const { app } = freshApp();
        const statuses = [];
        for (let i = 0; i < 11; i++) {
            statuses.push((await login(app)).status);
        }
        expect(statuses.slice(0, 10)).not.toContain(429);
        expect(statuses[10]).toBe(429);
    });

    it('RATE_LIMIT_ENABLED=false never returns 429', async () => {
        const { app } = freshApp({ RATE_LIMIT_ENABLED: 'false' });
        for (let i = 0; i < 12; i++) {
            expect((await login(app)).status).not.toBe(429);
        }
    });

    it('rate-limited responses carry draft-7 headers and no legacy X-RateLimit headers', async () => {
        const { app } = freshApp();
        const res = await login(app);
        expect(res.headers['ratelimit']).toBeDefined();
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    });

    it('CORS allowlist', async () => {
        const { app } = freshApp({ CORS_ALLOWED_ORIGINS: 'https://a.example' });

        const evil = await request(app).options('/blogs').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
        expect(evil.headers['access-control-allow-origin']).toBeUndefined();

        const good = await request(app).options('/blogs').set('Origin', 'https://a.example').set('Access-Control-Request-Method', 'POST');
        expect(good.headers['access-control-allow-origin']).toBe('https://a.example');
    });

    it('CORS defaults to * when no allowlist is configured', async () => {
        const { app } = freshApp();
        const res = await request(app).options('/blogs').set('Origin', 'https://anything.example').set('Access-Control-Request-Method', 'POST');
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('errors do not leak messages', async () => {
        const { app, BlogContent } = freshApp();
        BlogContent.mockImplementationOnce(doc => ({
            ...doc,
            save: jest.fn().mockRejectedValue(new Error('secret detail'))
        }));
        const res = await request(app)
            .post('/blogs')
            .set({ Authorization: `Bearer ${tokenFor('alice')}` })
            .send({ title: 'T', content: 'C' });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('secret detail');
    });
});
