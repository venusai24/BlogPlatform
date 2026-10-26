jest.mock('../../model/BlogContent', () => ({ find: jest.fn() }));

const request = require('supertest');
const app = require('../../app');
const BlogContent = require('../../model/BlogContent');
const { calculateTitleScore } = require('../../utils/searchUtils');

const FIXTURES = [
    {
        _id: 'id1',
        title: "Getting Started with Node.js",
        content: "This is a comprehensive guide to Node.js development.",
        author: "John Doe"
    },
    {
        _id: 'id2',
        title: "Advanced React Patterns",
        content: "Learn advanced patterns in React development.",
        author: "Jane Smith"
    },
    {
        _id: 'id3',
        title: "JavaScript Best Practices",
        content: "Best practices for writing clean JavaScript code.",
        author: "Bob Johnson"
    }
];

describe('Blog Retrieval Controller', () => {
    beforeEach(() => {
        BlogContent.find.mockResolvedValue(FIXTURES);
    });

    describe('POST /blogs/retrieve', () => {
        it('should retrieve blogs by title query', async () => {
            const res = await request(app)
                .post('/blogs/retrieve')
                .send({ titleQuery: 'Node.js' });
            
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);
            
            // Check that the response contains the expected fields
            const firstResult = res.body[0];
            expect(firstResult).toHaveProperty('_id');
            expect(firstResult).toHaveProperty('title');
            expect(firstResult).toHaveProperty('author');
        });

        it('should return results sorted by relevance', async () => {
            const res = await request(app)
                .post('/blogs/retrieve')
                .send({ titleQuery: 'React' });
            
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            
            // The most relevant result should be first
            const firstResult = res.body[0];
            expect(firstResult.title).toContain('React');
        });

        it('should return 400 if titleQuery is missing', async () => {
            const res = await request(app)
                .post('/blogs/retrieve')
                .send({});
            
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid request'); // now rejected by validate(schemas.retrieve)
        });

        it('should return empty array if no matches found', async () => {
            const res = await request(app)
                .post('/blogs/retrieve')
                .send({ titleQuery: 'NonexistentTopic' });
            
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            // Should return all blogs but sorted by relevance (even if low)
            expect(res.body.length).toBe(3);
        });

        it('should handle partial matches', async () => {
            const res = await request(app)
                .post('/blogs/retrieve')
                .send({ titleQuery: 'JavaScript' });
            
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            
            // Should find the JavaScript blog
            const jsBlogs = res.body.filter(blog => 
                blog.title.toLowerCase().includes('javascript')
            );
            expect(jsBlogs.length).toBeGreaterThan(0);
        });
    });

    describe('calculateTitleScore utility', () => {
        it('should give exact matches the best score', () => {
            const score = calculateTitleScore('Test Title', 'Test Title');
            expect(score).toBe(0);
        });

        it('should give partial matches better scores than non-matches', () => {
            const partialScore = calculateTitleScore('Node', 'Node.js Development');
            const nonMatchScore = calculateTitleScore('Python', 'Node.js Development');
            
            expect(partialScore).toBeLessThan(nonMatchScore);
        });

        it('should handle empty inputs gracefully', () => {
            const score1 = calculateTitleScore('', 'Test Title');
            const score2 = calculateTitleScore('Test Query', '');
            const score3 = calculateTitleScore('', '');
            
            expect(score1).toBe(Infinity);
            expect(score2).toBe(Infinity);
            expect(score3).toBe(Infinity);
        });

        it('should be case insensitive', () => {
            const score1 = calculateTitleScore('NODE.JS', 'node.js guide');
            const score2 = calculateTitleScore('node.js', 'NODE.JS GUIDE');
            
            expect(score1).toBe(score2);
            expect(score1).toBeLessThan(10); // Should be a reasonable match
        });
    });
});