const mockEmit = jest.fn();

jest.mock('../../socket', () => ({
    init: jest.fn(),
    getIO: jest.fn(() => ({ emit: mockEmit }))
}));

jest.mock('../../model/BlogContent', () => {
    const BlogContent = jest.fn().mockImplementation(doc => ({
        ...doc,
        _id: { toString: () => '64b7f0c2a1b2c3d4e5f60718' },
        save: jest.fn().mockResolvedValue()
    }));
    BlogContent.find = jest.fn().mockResolvedValue([]);
    BlogContent.findById = jest.fn();
    BlogContent.findOneAndUpdate = jest.fn();
    BlogContent.findByIdAndUpdate = jest.fn();
    BlogContent.exists = jest.fn();
    return BlogContent;
});

const request = require('supertest');
const app = require('../../app');
const BlogContent = require('../../model/BlogContent');
const { tokenFor } = require('../../test/helpers/auth');
const postWriter = require('../../services/postWriter');

const ID = '64b7f0c2a1b2c3d4e5f60718';
const CID = '64b7f0c2a1b2c3d4e5f60719';
const auth = (username) => ({ Authorization: `Bearer ${tokenFor(username)}` });

// findById(...).select(...) resolves to doc (used by likeBlog).
const selectable = (doc) => ({ select: () => Promise.resolve(doc) });

describe('Blog CRUD Controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks keeps implementations; reset the ones tests configure so they cannot leak.
        [BlogContent.findById, BlogContent.findOneAndUpdate, BlogContent.findByIdAndUpdate, BlogContent.exists]
            .forEach(fn => fn.mockReset());
    });

    it('should create a new blog post', async () => {
        const res = await request(app)
            .post('/blogs')
            .set(auth('Tester'))
            .send({ title: 'Test', content: 'Test content', author: 'Tester' });
        expect(res.statusCode).toBe(201);
        expect(res.body.blog).toHaveProperty('title', 'Test');
    });
    it('should get all blogs', async () => {
        const res = await request(app).get('/blogs');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    describe('postWriter delegation', () => {
        afterEach(() => jest.restoreAllMocks());

        it('POST /blogs delegates to postWriter.createPost', async () => {
            const created = { _id: ID, title: 'T', content: 'C', author: 'alice' };
            const spy = jest.spyOn(postWriter, 'createPost').mockResolvedValue(created);

            const res = await request(app)
                .post('/blogs')
                .set(auth('alice'))
                .send({ title: 'T', content: 'C', author: 'mallory' });

            expect(res.statusCode).toBe(201);
            expect(spy).toHaveBeenCalledWith({ title: 'T', content: 'C', summary: undefined, tags: undefined, author: 'alice' });
            expect(res.body.blog).toEqual(expect.objectContaining({ title: 'T' }));
        });

        it('PUT /blogs/:id delegates to postWriter.updatePost with only the provided fields', async () => {
            const doc = { author: 'alice', title: 'old' };
            BlogContent.findById.mockResolvedValue(doc);
            const spy = jest.spyOn(postWriter, 'updatePost').mockResolvedValue({ ...doc, title: 'new' });

            const res = await request(app).put(`/blogs/${ID}`).set(auth('alice')).send({ title: 'new' });

            expect(res.statusCode).toBe(200);
            expect(spy).toHaveBeenCalledWith(doc, { title: 'new' });
        });

        it('DELETE /blogs/:id delegates to postWriter.deletePost', async () => {
            const doc = { author: 'alice' };
            BlogContent.findById.mockResolvedValue(doc);
            const spy = jest.spyOn(postWriter, 'deletePost').mockResolvedValue();

            const res = await request(app).delete(`/blogs/${ID}`).set(auth('alice'));

            expect(res.statusCode).toBe(200);
            expect(spy).toHaveBeenCalledWith(doc);
        });

        it('DELETE /blogs/:id by a non-author returns 403 and deletes nothing', async () => {
            BlogContent.findById.mockResolvedValue({ author: 'bob' });
            const spy = jest.spyOn(postWriter, 'deletePost').mockResolvedValue();

            const res = await request(app).delete(`/blogs/${ID}`).set(auth('alice'));

            expect(res.statusCode).toBe(403);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('create authorization', () => {
        it('POST /blogs without a token returns 401', async () => {
            const res = await request(app)
                .post('/blogs')
                .send({ title: 'Test', content: 'Test content', author: 'Tester' });
            expect(res.statusCode).toBe(401);
            expect(BlogContent).not.toHaveBeenCalled();
        });

        it('POST /blogs uses the token username, not body.author', async () => {
            const res = await request(app)
                .post('/blogs')
                .set(auth('alice'))
                .send({ title: 'T', content: 'C', author: 'mallory' });
            expect(res.statusCode).toBe(201);
            expect(BlogContent).toHaveBeenCalledWith(expect.objectContaining({ author: 'alice' }));
        });

        it('with AUTH_REQUIRED_WRITES=false, POST /blogs without a token returns 201', async () => {
            process.env.AUTH_REQUIRED_WRITES = 'false';
            try {
                let isolatedApp;
                let IsolatedBlogContent;
                jest.isolateModules(() => {
                    isolatedApp = require('../../app');
                    IsolatedBlogContent = require('../../model/BlogContent');
                });
                const res = await request(isolatedApp)
                    .post('/blogs')
                    .send({ title: 'T', content: 'C', author: 'Tester' });
                expect(res.statusCode).toBe(201);
                expect(IsolatedBlogContent).toHaveBeenCalledWith(expect.objectContaining({ author: 'Tester' }));
            } finally {
                delete process.env.AUTH_REQUIRED_WRITES;
            }
        });
    });

    describe('ownership', () => {
        it('PUT /blogs/:id by a non-author returns 403', async () => {
            const save = jest.fn();
            BlogContent.findById.mockResolvedValue({ author: 'bob', save });
            const res = await request(app)
                .put(`/blogs/${ID}`)
                .set(auth('alice'))
                .send({ title: 'hijack' });
            expect(res.statusCode).toBe(403);
            expect(save).not.toHaveBeenCalled();
        });
    });

    describe('ObjectId validation', () => {
        const BAD = 'not-an-id';
        it.each([
            ['PUT', `/blogs/${BAD}`, { title: 'x' }],
            ['DELETE', `/blogs/${BAD}`, undefined],
            ['PUT', `/blogs/${BAD}/like`, undefined],
            ['POST', `/blogs/${BAD}/comments`, { comment: 'hi' }],
            ['POST', `/blogs/${BAD}/comments/${CID}/replies`, { reply: 'yo' }],
            ['POST', `/blogs/${ID}/comments/${BAD}/replies`, { reply: 'yo' }]
        ])('%s %s returns 400', async (method, url, body) => {
            const res = await request(app)[method.toLowerCase()](url).set(auth('alice')).send(body);
            expect(res.statusCode).toBe(400);
            expect(BlogContent.findById).not.toHaveBeenCalled();
        });
    });

    describe('likes', () => {
        it('PUT /blogs/:id/like adds atomically', async () => {
            BlogContent.findById.mockReturnValue(selectable({ author: 'bob', likedBy: [] }));
            BlogContent.findOneAndUpdate.mockResolvedValue({ likes: 1, likedBy: ['alice'] });

            const res = await request(app).put(`/blogs/${ID}/like`).set(auth('alice'));

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual(expect.objectContaining({ likes: 1, likedBy: ['alice'] }));
            expect(BlogContent.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: ID, likedBy: { $ne: 'alice' } },
                { $addToSet: { likedBy: 'alice' }, $inc: { likes: 1 } },
                { new: true }
            );
            expect(mockEmit).toHaveBeenCalledWith('like_updated', { blogId: ID, likes: 1, likedBy: ['alice'] });
        });

        it('PUT /blogs/:id/like removes atomically when already liked', async () => {
            BlogContent.findById.mockReturnValue(selectable({ author: 'bob', likedBy: ['alice'] }));
            BlogContent.findOneAndUpdate.mockResolvedValue({ likes: 0, likedBy: [] });

            const res = await request(app).put(`/blogs/${ID}/like`).set(auth('alice'));

            expect(res.statusCode).toBe(200);
            expect(BlogContent.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: ID, likedBy: 'alice' },
                { $pull: { likedBy: 'alice' }, $inc: { likes: -1 } },
                { new: true }
            );
        });

        it('PUT /blogs/:id/like re-reads the post when a concurrent toggle wins the race', async () => {
            BlogContent.findById
                .mockReturnValueOnce(selectable({ author: 'bob', likedBy: [] }))
                .mockReturnValueOnce(selectable({ likes: 1, likedBy: ['alice'] }));
            BlogContent.findOneAndUpdate.mockResolvedValue(null);

            const res = await request(app).put(`/blogs/${ID}/like`).set(auth('alice'));

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual(expect.objectContaining({ likes: 1, likedBy: ['alice'] }));
        });

        it('PUT /blogs/:id/like on your own post returns 400', async () => {
            BlogContent.findById.mockReturnValue(selectable({ author: 'alice', likedBy: [] }));
            const res = await request(app).put(`/blogs/${ID}/like`).set(auth('alice'));
            expect(res.statusCode).toBe(400);
            expect(BlogContent.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('PUT /blogs/:id/like on a missing post returns 404', async () => {
            BlogContent.findById.mockReturnValue(selectable(null));
            const res = await request(app).put(`/blogs/${ID}/like`).set(auth('alice'));
            expect(res.statusCode).toBe(404);
        });
    });

    describe('comments and replies', () => {
        it('POST /blogs/:id/comments uses $push', async () => {
            BlogContent.findByIdAndUpdate.mockResolvedValue({ comments: [{ user: 'alice', comment: 'hi' }] });

            const res = await request(app)
                .post(`/blogs/${ID}/comments`)
                .set(auth('alice'))
                .send({ comment: 'hi' });

            expect(res.statusCode).toBe(201);
            expect(BlogContent.findByIdAndUpdate).toHaveBeenCalledWith(
                ID,
                { $push: { comments: { user: 'alice', comment: 'hi' } } },
                { new: true }
            );
            expect(mockEmit).toHaveBeenCalledWith('new_comment', expect.objectContaining({ blogId: ID }));
        });

        it('POST /blogs/:id/comments on a missing post returns 404', async () => {
            BlogContent.findByIdAndUpdate.mockResolvedValue(null);
            const res = await request(app)
                .post(`/blogs/${ID}/comments`)
                .set(auth('alice'))
                .send({ comment: 'hi' });
            expect(res.statusCode).toBe(404);
        });

        it('POST /blogs/:id/comments/:cid/replies uses positional $push', async () => {
            BlogContent.findOneAndUpdate.mockResolvedValue({ comments: [] });

            const res = await request(app)
                .post(`/blogs/${ID}/comments/${CID}/replies`)
                .set(auth('alice'))
                .send({ reply: 'yo' });

            expect(res.statusCode).toBe(201);
            expect(BlogContent.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: ID, 'comments._id': CID },
                { $push: { 'comments.$.replies': { user: 'alice', reply: 'yo' } } },
                { new: true }
            );
        });

        it('POST replies returns 404 "Comment not found" when only the comment is missing', async () => {
            BlogContent.findOneAndUpdate.mockResolvedValue(null);
            BlogContent.exists.mockResolvedValue({ _id: ID });
            const res = await request(app)
                .post(`/blogs/${ID}/comments/${CID}/replies`)
                .set(auth('alice'))
                .send({ reply: 'yo' });
            expect(res.statusCode).toBe(404);
            expect(res.body.message).toBe('Comment not found');
        });

        it('POST replies returns 404 "Blog post not found" when the post is missing', async () => {
            BlogContent.findOneAndUpdate.mockResolvedValue(null);
            BlogContent.exists.mockResolvedValue(null);
            const res = await request(app)
                .post(`/blogs/${ID}/comments/${CID}/replies`)
                .set(auth('alice'))
                .send({ reply: 'yo' });
            expect(res.statusCode).toBe(404);
            expect(res.body.message).toBe('Blog post not found');
        });
    });
});
