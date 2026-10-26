jest.mock('../vectorStore', () => ({
  getVectorStore: () => ({
    search: jest.fn().mockResolvedValue([
      { id: 'pa', score: 0.9, payload: { blogId: 'a', title: 'A', snippet: 's', author: 'x' } },
      { id: 'pb', score: 0.1, payload: { blogId: 'b', title: 'B', snippet: 't', author: 'y' } }
    ])
  })
}));
jest.mock('../embeddingService', () => ({ embed: jest.fn().mockResolvedValue([[0.1, 0.2]]) }));
jest.mock('../llmService', () => ({ transformQuery: q => Promise.resolve(q) }));
jest.mock('../../model/BlogContent', () => ({
  find: jest.fn(() => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) }))
}));

const { searchBlogs } = require('../semanticSearchService');
const BlogContent = require('../../model/BlogContent');

describe('semanticSearchService.searchBlogs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('drops dense hits below minDenseScore before fusion', async () => {
    const results = await searchBlogs('q', { searchType: 'title', limit: 5, minDenseScore: 0.5 });
    expect(results.map(r => r.id)).toEqual(['a']);
  });

  it('keeps every dense hit when minDenseScore is not given', async () => {
    const results = await searchBlogs('q', { searchType: 'title', limit: 5 });
    expect(results.map(r => r.id).sort()).toEqual(['a', 'b']);
  });

  it('exposes denseScore', async () => {
    const results = await searchBlogs('q', { searchType: 'title', limit: 5, minDenseScore: 0.5 });
    expect(results[0].denseScore).toBe(0.9);
  });

  it('sets denseScore to null for lexical-only hits', async () => {
    BlogContent.find.mockReturnValueOnce({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([
        { _id: { toString: () => 'lex' }, title: 'L', content: 'body', author: 'z' }
      ]) }) })
    });
    const results = await searchBlogs('q', { searchType: 'title', limit: 5, minDenseScore: 0.5 });
    const lexical = results.find(r => r.id === 'lex');
    expect(lexical).toBeDefined();
    expect(lexical.denseScore).toBeNull();
  });

  it('clears its timeout', async () => {
    const spy = jest.spyOn(global, 'clearTimeout');
    await searchBlogs('q', { searchType: 'title', limit: 5 });
    expect(spy).toHaveBeenCalled();
  });

  it('leaves no pending timer behind', async () => {
    jest.useFakeTimers();
    await searchBlogs('q', { searchType: 'title', limit: 5 });
    expect(jest.getTimerCount()).toBe(0);
  });
});
