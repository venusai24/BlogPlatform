const request = require('supertest');
const app = require('../../app');
const semanticSearchService = require('../../services/semanticSearchService');
const BlogContent = require('../../model/BlogContent');

jest.mock('../../services/semanticSearchService');
jest.mock('../../model/BlogContent');
jest.mock('../../services/qdrantService', () => ({
    initQdrant: jest.fn(),
    getQdrantClient: jest.fn()
}));
jest.mock('../../services/redisClient', () => ({
    ping: jest.fn(),
    isReady: true,
    isOpen: true,
    get: jest.fn(),
    set: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn()
}));

const ID = '64b7f0c2a1b2c3d4e5f60718';
const dbBlog = (id = ID) => ({ _id: { toString: () => id }, title: 'T', author: 'A', createdAt: '2026-01-01' });

describe('POST /blogs/semanticSearchbyTitle', () => {
    afterEach(() => {
        jest.resetAllMocks();
    });

    it('title search returns results despite RRF-scale scores', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue([
            { id: ID, score: 0.016, denseScore: 0.81, title: 'T', author: 'A' }
        ]);
        BlogContent.find.mockResolvedValue([dbBlog()]);

        const res = await request(app).post('/blogs/semanticSearchbyTitle').send({ query: 'q' });

        expect(res.status).toBe(200);
        expect(res.body.results.length).toBe(1);
        expect(res.body.results[0].similarity).toBe(0.81);
    });

    it('passes the request threshold to searchBlogs as minDenseScore', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue([]);

        await request(app).post('/blogs/semanticSearchbyTitle').send({ query: 'q', limit: 7, threshold: 0.5 });

        expect(semanticSearchService.searchBlogs).toHaveBeenCalledWith(
            'q',
            { searchType: 'title', limit: 7, minDenseScore: 0.5 }
        );
    });

    it('defaults the threshold to 0.3', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue([]);

        await request(app).post('/blogs/semanticSearchbyTitle').send({ query: 'q' });

        expect(semanticSearchService.searchBlogs).toHaveBeenCalledWith(
            'q',
            expect.objectContaining({ minDenseScore: 0.3 })
        );
    });

    it('excludes lexical-only hits', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue([
            { id: ID, score: 0.03, denseScore: 0.7, title: 'T', author: 'A' },
            { id: '64b7f0c2a1b2c3d4e5f60719', score: 0.02, denseScore: null, title: 'L', author: 'A' }
        ]);
        BlogContent.find.mockResolvedValue([dbBlog(), dbBlog('64b7f0c2a1b2c3d4e5f60719')]);

        const res = await request(app).post('/blogs/semanticSearchbyTitle').send({ query: 'q' });

        expect(res.body.results).toHaveLength(1);
        expect(BlogContent.find).toHaveBeenCalledWith({ _id: { $in: [ID] } });
    });

    it('fallback escapes regex input', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue(null);
        BlogContent.find.mockReturnValue({ limit: () => Promise.resolve([dbBlog()]) });

        const res = await request(app).post('/blogs/semanticSearchbyTitle').send({ query: 'a.*(' });

        expect(res.status).toBe(200);
        expect(BlogContent.find).toHaveBeenCalledWith({ title: { $regex: 'a\\.\\*\\(', $options: 'i' } });
    });
});
