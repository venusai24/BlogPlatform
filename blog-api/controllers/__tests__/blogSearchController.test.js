const request = require('supertest');
const app = require('../../app');
const semanticSearchService = require('../../services/semanticSearchService');
const BlogContent = require('../../model/BlogContent');
const llmService = require('../../services/llmService');

jest.mock('../../services/semanticSearchService');
jest.mock('../../model/BlogContent');
// Also mock Qdrant init to avoid errors
jest.mock('../../services/qdrantService', () => ({
    initQdrant: jest.fn(),
    getQdrantClient: jest.fn()
}));
jest.mock('../../services/llmService', () => ({
    generateRagAnswer: jest.fn(),
    transformQuery: jest.fn()
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

describe('BlogSearchController', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return semantic search results with X-Search-Mode header', async () => {
        const mockResults = [
            { id: '1', title: 'Test', snippet: 'Snippet', score: 0.9, author: 'Author 1' }
        ];
        semanticSearchService.searchBlogs.mockResolvedValue(mockResults);

        const res = await request(app).get('/blogs/search?query=test');

        expect(res.status).toBe(200);
        expect(res.headers['x-search-mode']).toBe('semantic');
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Test');
    });

    it('should fallback to Mongo $text search if semantic search returns null', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue(null);

        const mockMongoResults = [
            { _id: '2', title: 'Fallback Title', content: 'Fallback content', author: 'Author 2', _doc: { score: 1.5 } }
        ];

        BlogContent.find.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue(mockMongoResults)
            })
        });

        const res = await request(app).get('/blogs/search?query=fallback');

        expect(res.status).toBe(200);
        expect(res.headers['x-search-mode']).toBe('fallback');
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Fallback Title');
        expect(res.body[0].id).toBe('2');
        expect(BlogContent.find).toHaveBeenCalledWith(
            { $text: { $search: 'fallback' } },
            { score: { $meta: "textScore" } }
        );
    });

    it('GET /blogs/search asks for dense matches of at least 0.2', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue([]);

        await request(app).get('/blogs/search?query=test');

        expect(semanticSearchService.searchBlogs).toHaveBeenCalledWith(
            'test',
            expect.objectContaining({ minDenseScore: 0.2 })
        );
    });

    it('POST /blogs/ask asks for dense matches of at least 0.1', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue([]);

        await request(app).post('/blogs/ask').send({ query: 'why' });

        expect(semanticSearchService.searchBlogs).toHaveBeenCalledWith(
            'why',
            expect.objectContaining({ searchType: 'content', minDenseScore: 0.1 })
        );
    });

    it('POST /blogs/ask falls back to lexical search when semantic search returns null', async () => {
        semanticSearchService.searchBlogs.mockResolvedValue(null);
        BlogContent.find.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([
                    { _id: '3', title: 'Lexical', content: 'Some body text', author: 'Author 3', _doc: { score: 1.2 } }
                ])
            })
        });
        llmService.generateRagAnswer.mockResolvedValue({ answer: 'A', generationId: null });

        const res = await request(app).post('/blogs/ask').send({ query: 'body' });

        expect(res.status).toBe(200);
        expect(res.body.sources.length).toBe(1);
        expect(res.body.sources[0].title).toBe('Lexical');
        expect(res.body.answer).toBe('A');
    });
});
