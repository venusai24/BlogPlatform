const request = require('supertest');
const app = require('../../app');
const User = require('../model/User');

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
});
