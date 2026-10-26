const { v5: uuidv5 } = require('uuid');

const NS = '1b671a64-40d5-491e-99b0-da01ff1f3341';
const mockCalls = [];
const mockStore = {
  upsert: jest.fn(async (collection, points) => { mockCalls.push({ op: 'upsert', collection, points }); }),
  deleteByIds: jest.fn(async (collection, ids) => { mockCalls.push({ op: 'deleteByIds', collection, ids }); }),
  deleteByPost: jest.fn(async (collection, postId) => { mockCalls.push({ op: 'deleteByPost', collection, postId }); })
};

let mockWriteStores;
jest.mock('../../vectorStore', () => ({
  getVectorStore: () => mockStore,
  getWriteStores: () => mockWriteStores
}));
jest.mock('../../embeddingService', () => ({ embed: jest.fn(async texts => texts.map(() => [0.1, 0.2, 0.3])) }));
jest.mock('../../../model/BlogContent', () => ({ findById: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../../utils/chunkText', () => ({ chunkText: jest.fn() }));

const BlogContent = require('../../../model/BlogContent');
const { chunkText } = require('../../../utils/chunkText');
const { indexPost, removePost, reconcilePost, MAX_CONTENT_CHUNKS } = require('../postIndexer');

const chunkId = (id, i) => uuidv5(`${id}_content_${i}`, NS);
const summaryId = id => uuidv5(`${id}_summary`, NS);
const blogDoc = (overrides = {}) => ({
  _id: 'p1',
  title: 'Title',
  content: 'Body',
  author: 'alice',
  summary: 'A summary',
  revision: 3,
  ...overrides
});

describe('postIndexer', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.clearAllMocks();
    mockWriteStores = [mockStore];
    chunkText.mockReturnValue(['c0', 'c1']);
    BlogContent.updateOne.mockResolvedValue({});
  });

  describe('indexPost', () => {
    it('keeps the legacy deterministic ids', async () => {
      await indexPost(blogDoc({ indexedChunkCount: 2 }));

      const titleUpsert = mockCalls.find(c => c.op === 'upsert' && c.collection === 'blog_titles');
      expect(titleUpsert.points[0].id).toBe(uuidv5('p1_title', NS));
      const contentUpsert = mockCalls.find(c => c.op === 'upsert' && c.collection === 'blog_content');
      expect(contentUpsert.points.map(p => p.id)).toEqual([chunkId('p1', 0), chunkId('p1', 1)]);
      const summaryUpsert = mockCalls.find(c => c.op === 'upsert' && c.collection === 'blog_summaries');
      expect(summaryUpsert.points[0].id).toBe(summaryId('p1'));
    });

    it('writes the same payload as before plus chunkIndex on content points', async () => {
      await indexPost(blogDoc({ indexedChunkCount: 2 }));

      const content = mockCalls.find(c => c.op === 'upsert' && c.collection === 'blog_content');
      expect(content.points[1].payload).toEqual({ blogId: 'p1', title: 'Title', snippet: 'c1', author: 'alice', chunkIndex: 1 });
      expect(content.points[1].vector).toEqual([0.1, 0.2, 0.3]);
      const title = mockCalls.find(c => c.op === 'upsert' && c.collection === 'blog_titles');
      expect(title.points[0].payload).toEqual({ blogId: 'p1', title: 'Title', snippet: 'Body', author: 'alice' });
    });

    it('upserts before pruning stale chunks', async () => {
      await indexPost(blogDoc({ indexedChunkCount: 5 }));

      const last = mockCalls[mockCalls.length - 1];
      expect(last).toEqual({
        op: 'deleteByIds',
        collection: 'blog_content',
        ids: [chunkId('p1', 2), chunkId('p1', 3), chunkId('p1', 4)]
      });
      const lastUpsert = mockCalls.map(c => c.op).lastIndexOf('upsert');
      expect(lastUpsert).toBeLessThan(mockCalls.length - 1);
    });

    it('does not prune when the chunk count grows or stays the same', async () => {
      await indexPost(blogDoc({ indexedChunkCount: 2 }));
      expect(mockCalls.some(c => c.op === 'deleteByIds' && c.collection === 'blog_content')).toBe(false);
    });

    it('legacy doc deletes by post before upsert', async () => {
      await indexPost(blogDoc());

      expect(mockCalls[0]).toEqual({ op: 'deleteByPost', collection: 'blog_content', postId: 'p1' });
      const firstUpsert = mockCalls.findIndex(c => c.op === 'upsert');
      expect(firstUpsert).toBeGreaterThan(0);
    });

    it('empty summary deletes the summary point', async () => {
      await indexPost(blogDoc({ summary: '   ', indexedChunkCount: 2 }));

      expect(mockCalls.some(c => c.op === 'upsert' && c.collection === 'blog_summaries')).toBe(false);
      expect(mockCalls).toContainEqual({ op: 'deleteByIds', collection: 'blog_summaries', ids: [summaryId('p1')] });
    });

    it('records the indexed revision guarded by revision', async () => {
      await indexPost(blogDoc({ indexedChunkCount: 2 }));

      expect(BlogContent.updateOne).toHaveBeenCalledWith(
        { _id: 'p1', $or: [{ revision: 3 }, { revision: { $exists: false } }] },
        { $set: { indexedChunkCount: 2, indexedRevision: 3, indexedAt: expect.any(Date) } }
      );
    });

    it('treats a missing revision as 0', async () => {
      await indexPost(blogDoc({ revision: undefined, indexedChunkCount: 2 }));

      expect(BlogContent.updateOne.mock.calls[0][0].$or[0]).toEqual({ revision: 0 });
      expect(BlogContent.updateOne.mock.calls[0][1].$set.indexedRevision).toBe(0);
    });

    it('rejects content over 256 chunks before touching the store', async () => {
      chunkText.mockReturnValue(Array(MAX_CONTENT_CHUNKS + 1).fill('x'));

      await expect(indexPost(blogDoc())).rejects.toThrow('content too long to index');

      expect(mockCalls).toHaveLength(0);
      expect(BlogContent.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('removePost', () => {
    it('deletes the post from all three collections', async () => {
      await removePost('p1');

      expect(mockCalls).toEqual([
        { op: 'deleteByPost', collection: 'blog_titles', postId: 'p1' },
        { op: 'deleteByPost', collection: 'blog_content', postId: 'p1' },
        { op: 'deleteByPost', collection: 'blog_summaries', postId: 'p1' }
      ]);
    });

    it('propagates store errors', async () => {
      mockStore.deleteByPost.mockRejectedValueOnce(new Error('qdrant down'));
      await expect(removePost('p1')).rejects.toThrow('qdrant down');
    });
  });

  describe('reconcilePost', () => {
    it('removes vectors for a missing post', async () => {
      BlogContent.findById.mockResolvedValue(null);

      const result = await reconcilePost('p1');

      expect(result).toEqual({ action: 'removed' });
      expect(mockCalls.filter(c => c.op === 'deleteByPost')).toHaveLength(3);
    });

    it('skips an up-to-date post', async () => {
      BlogContent.findById.mockResolvedValue(blogDoc({ revision: 3, indexedRevision: 3 }));

      const result = await reconcilePost('p1');

      expect(result).toEqual({ action: 'skipped' });
      expect(mockCalls).toHaveLength(0);
    });

    it('skips when indexedRevision is ahead of revision', async () => {
      BlogContent.findById.mockResolvedValue(blogDoc({ revision: 2, indexedRevision: 3 }));
      expect(await reconcilePost('p1')).toEqual({ action: 'skipped' });
    });

    it('indexes a stale post', async () => {
      BlogContent.findById.mockResolvedValue(blogDoc({ revision: 4, indexedRevision: 3, indexedChunkCount: 2 }));

      const result = await reconcilePost('p1');

      expect(result).toEqual({ action: 'indexed' });
      expect(mockCalls.some(c => c.op === 'upsert')).toBe(true);
    });

    it('indexes a post that was never indexed', async () => {
      BlogContent.findById.mockResolvedValue(blogDoc());
      expect(await reconcilePost('p1')).toEqual({ action: 'indexed' });
    });
  });

  describe('dual write (VECTOR_STORE_WRITE=both)', () => {
    const makeStore = (name, log) => ({
      upsert: jest.fn(async (collection) => { log.push(`${name}:upsert:${collection}`); }),
      deleteByIds: jest.fn(async (collection) => { log.push(`${name}:deleteByIds:${collection}`); }),
      deleteByPost: jest.fn(async (collection) => { log.push(`${name}:deleteByPost:${collection}`); })
    });

    it('indexPost writes every point to every write store', async () => {
      const log = [];
      const a = makeStore('a', log);
      const b = makeStore('b', log);
      mockWriteStores = [a, b];

      await indexPost(blogDoc({ indexedChunkCount: 2 }));

      for (const store of [a, b]) {
        expect(store.upsert.mock.calls.map(c => c[0])).toEqual(['blog_titles', 'blog_content', 'blog_summaries']);
      }
      expect(BlogContent.updateOne).toHaveBeenCalledTimes(1);
    });

    it('does not record progress when one of the stores fails', async () => {
      const log = [];
      const a = makeStore('a', log);
      const b = makeStore('b', log);
      b.upsert.mockRejectedValue(new Error('s3vectors throttled'));
      mockWriteStores = [a, b];

      await expect(indexPost(blogDoc({ indexedChunkCount: 2 }))).rejects.toThrow('s3vectors throttled');

      expect(BlogContent.updateOne).not.toHaveBeenCalled();
    });

    it('removePost deletes from every write store', async () => {
      const log = [];
      mockWriteStores = [makeStore('a', log), makeStore('b', log)];

      await removePost('p1');

      expect(log.filter(l => l.includes('deleteByPost'))).toHaveLength(6);
    });
  });
});
