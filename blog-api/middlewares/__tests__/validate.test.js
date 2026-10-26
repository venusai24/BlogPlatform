const validate = require('../validate');
const schemas = require('../../validation/schemas');

function run(middleware, req) {
  const res = {
    status: jest.fn(function () { return this; }),
    json: jest.fn()
  };
  const next = jest.fn();
  middleware(req, res, next);
  return { res, next };
}

describe('validate middleware', () => {
  it('rejects a 201-char title with 400 and an issues array', () => {
    const req = { body: { title: 'a'.repeat(201), content: 'c' } };
    const { res, next } = run(validate(schemas.createBlog), req);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid request',
      issues: [{ path: 'title', message: expect.any(String) }]
    });
  });

  it('coerces limit to a number and applies defaults', () => {
    const req = { query: { query: 'x', limit: '5' } };
    const { next } = run(validate(schemas.searchQuery, 'query'), req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query).toEqual({ query: 'x', searchType: 'content', limit: 5 });

    const bare = { query: { query: 'x' } };
    run(validate(schemas.searchQuery, 'query'), bare);
    expect(bare.query.limit).toBe(10);
  });

  it('rejects limit=1000 on searchQuery', () => {
    const req = { query: { query: 'x', limit: '1000' } };
    const { res, next } = run(validate(schemas.searchQuery, 'query'), req);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].issues[0].path).toBe('limit');
  });

  it('trims strings and strips unknown keys on success', () => {
    const req = { body: { comment: '  hi  ', admin: true } };
    const { next } = run(validate(schemas.comment), req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ comment: 'hi' });
  });

  it('rejects a whitespace-only title', () => {
    const { res } = run(validate(schemas.createBlog), { body: { title: '   ', content: 'c' } });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createBlog accepts a legacy author and bounded tags, and rejects 11 tags', () => {
    const ok = { body: { title: 't', content: 'c', author: 'bob', tags: ['a'] } };
    expect(run(validate(schemas.createBlog), ok).next).toHaveBeenCalled();

    const tooMany = { body: { title: 't', content: 'c', tags: Array(11).fill('a') } };
    expect(run(validate(schemas.createBlog), tooMany).res.status).toHaveBeenCalledWith(400);
  });

  it('updateBlog is partial and drops author', () => {
    const req = { body: { title: 'new', author: 'mallory' } };
    const { next } = run(validate(schemas.updateBlog), req);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ title: 'new' });
  });

  it('ask applies defaults and bounds limit to 10', () => {
    const req = { body: { query: 'why' } };
    run(validate(schemas.ask), req);
    expect(req.body).toEqual({ query: 'why', detailLevel: 'brief', limit: 5 });

    expect(run(validate(schemas.ask), { body: { query: 'why', limit: 11 } }).res.status).toHaveBeenCalledWith(400);
  });

  it('semanticTitle defaults limit and threshold, and bounds threshold to 0..1', () => {
    const req = { body: { query: 'q' } };
    run(validate(schemas.semanticTitle), req);
    expect(req.body).toEqual({ query: 'q', limit: 10, threshold: 0.3 });

    expect(run(validate(schemas.semanticTitle), { body: { query: 'q', threshold: 1.5 } }).res.status).toHaveBeenCalledWith(400);
  });

  it('register enforces username charset/length and password length; login is lenient', () => {
    const bad = (body) => run(validate(schemas.register), { body }).res.status.mock.calls.length === 1;
    expect(bad({ username: 'ab', password: 'longenough' })).toBe(true);
    expect(bad({ username: 'has space', password: 'longenough' })).toBe(true);
    expect(bad({ username: 'alice', password: 'short' })).toBe(true);
    expect(bad({ username: 'alice_1.x-y', password: 'longenough' })).toBe(false);

    expect(run(validate(schemas.login), { body: { username: 'a', password: 'x' } }).next).toHaveBeenCalled();
  });

  it('feedback requires a 24-hex generationId and a score of 1 or -1', () => {
    const id = '64b7f0c2a1b2c3d4e5f60718';
    expect(run(validate(schemas.feedback), { body: { generationId: id, feedbackScore: -1 } }).next).toHaveBeenCalled();
    expect(run(validate(schemas.feedback), { body: { generationId: id, feedbackScore: 5 } }).res.status).toHaveBeenCalledWith(400);
    expect(run(validate(schemas.feedback), { body: { generationId: 'nope', feedbackScore: 1 } }).res.status).toHaveBeenCalledWith(400);
  });

  it('summarize and retrieve enforce their length limits', () => {
    expect(run(validate(schemas.summarize), { body: { content: 'x'.repeat(50001) } }).res.status).toHaveBeenCalledWith(400);
    expect(run(validate(schemas.retrieve), { body: { titleQuery: 'x'.repeat(201) } }).res.status).toHaveBeenCalledWith(400);
    expect(run(validate(schemas.retrieve), { body: {} }).res.status).toHaveBeenCalledWith(400);
  });
});
