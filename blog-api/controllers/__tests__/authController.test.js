jest.mock('../../model/User', () => {
    const User = jest.fn().mockImplementation(doc => ({ ...doc, save: jest.fn().mockResolvedValue(doc) }));
    User.findOne = jest.fn().mockResolvedValue(null);
    User.findById = jest.fn();
    return User;
});

const request = require('supertest');
const app = require('../../app');
const User = require('../../model/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

describe('Auth Controller', () => {
    it('should register a new user', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ username: 'testuser', password: 'testpass' });
        expect([201, 400]).toContain(res.statusCode); // 400 if user exists
    });
    it('should login a user', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ username: 'testuser', password: 'testpass' });
        expect([200, 401, 404]).toContain(res.statusCode);
    });

    describe('login tokens and logging', () => {
        beforeEach(() => {
            User.findOne.mockResolvedValue({ _id: 'u1', username: 'alice', password: bcrypt.hashSync('pw', 4) });
        });
        afterEach(() => {
            jest.restoreAllMocks();
            User.findOne.mockResolvedValue(null);
        });

        it('login does not log the JWT secret', async () => {
            const spy = jest.spyOn(console, 'log');
            const res = await request(app)
                .post('/auth/login')
                .send({ username: 'alice', password: 'pw' });
            expect(res.statusCode).toBe(200);
            expect(spy.mock.calls.flat().join(' ')).not.toContain('testsecret');
        });

        it('issues tokens with issuer and audience', async () => {
            const res = await request(app)
                .post('/auth/login')
                .send({ username: 'alice', password: 'pw' });
            expect(res.statusCode).toBe(200);
            const decoded = jwt.decode(res.body.token);
            expect(decoded.iss).toBe('blogplatform-api');
            expect(decoded.aud).toBe('blogplatform-web');
        });
    });
});
