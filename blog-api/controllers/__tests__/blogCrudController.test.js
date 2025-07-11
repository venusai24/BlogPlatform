const request = require('supertest');
const app = require('../../app');
const mongoose = require('mongoose');
const BlogContent = require('../model/BlogContent');

describe('Blog CRUD Controller', () => {
    beforeAll(async () => {
        // Connect to a test database
        await mongoose.connect(process.env.DATABASE_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    });
    afterAll(async () => {
        await mongoose.connection.close();
    });
    it('should create a new blog post', async () => {
        const res = await request(app)
            .post('/blogs')
            .send({ title: 'Test', content: 'Test content', author: 'Tester' });
        expect(res.statusCode).toBe(201);
        expect(res.body.blog).toHaveProperty('title', 'Test');
    });
    it('should get all blogs', async () => {
        const res = await request(app).get('/blogs');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});
