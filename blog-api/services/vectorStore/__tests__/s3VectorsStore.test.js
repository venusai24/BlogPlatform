const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3vectors', () => {
  const command = name => class { constructor(input) { this.input = input; this.name = name; } };
  return {
    S3VectorsClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
    GetIndexCommand: command('GetIndex'),
    PutVectorsCommand: command('PutVectors'),
    DeleteVectorsCommand: command('DeleteVectors'),
    QueryVectorsCommand: command('QueryVectors'),
    ListVectorsCommand: command('ListVectors')
  };
});

const config = require('../../../src/config');
const store = require('../s3VectorsStore');
const { chunkId, titleId, summaryId, MAX_CONTENT_CHUNKS } = require('../../indexing/pointIds');

const BUCKET = 'blogplatform-prod-vectors';
const sent = name => mockSend.mock.calls.map(([command]) => command).filter(c => c.name === name);

describe('s3VectorsStore', () => {
  const originalBucket = config.s3VectorsBucket;
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
    config.s3VectorsBucket = BUCKET;
  });
  afterEach(() => {
    config.s3VectorsBucket = originalBucket;
  });

  it('refuses to run without a bucket name', async () => {
    config.s3VectorsBucket = undefined;
    await expect(store.upsert('blog_titles', [])).rejects.toThrow('S3_VECTORS_BUCKET');
  });

  describe('collection names', () => {
    it('maps collection names to index names', async () => {
      await store.upsert('blog_titles', [{ id: 'a', vector: [1], payload: {} }]);
      await store.upsert('blog_content', [{ id: 'b', vector: [1], payload: {} }]);
      await store.upsert('blog_summaries', [{ id: 'c', vector: [1], payload: {} }]);

      expect(sent('PutVectors').map(c => c.input.indexName)).toEqual(['blog-titles', 'blog-content', 'blog-summaries']);
      expect(sent('PutVectors').every(c => c.input.vectorBucketName === BUCKET)).toBe(true);
    });

    it('rejects an unknown collection', async () => {
      await expect(store.upsert('blog_comments', [])).rejects.toThrow('Unknown collection');
    });
  });

  describe('ensureCollections', () => {
    it('verifies each index with GetIndex', async () => {
      await store.ensureCollections(512);

      expect(sent('GetIndex').map(c => c.input)).toEqual([
        { vectorBucketName: BUCKET, indexName: 'blog-titles' },
        { vectorBucketName: BUCKET, indexName: 'blog-content' },
        { vectorBucketName: BUCKET, indexName: 'blog-summaries' }
      ]);
    });

    it('throws a helpful error when an index is missing (the persistent stack creates them)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NotFoundException' }));

      await expect(store.ensureCollections(512)).rejects.toThrow(/blog-titles.*persistent/s);
    });

    it('throws when an index has a different dimension', async () => {
      mockSend.mockResolvedValue({ index: { dimension: 1024 } });

      await expect(store.ensureCollections(512)).rejects.toThrow(/dimension/);
    });

    it('accepts an index with the expected dimension', async () => {
      mockSend.mockResolvedValue({ index: { dimension: 512 } });
      await expect(store.ensureCollections(512)).resolves.toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('sends float32 data and the payload as metadata', async () => {
      await store.upsert('blog_content', [{ id: 'k1', vector: [0.1, 0.2], payload: { blogId: 'p', snippet: 's' } }]);

      expect(sent('PutVectors')[0].input.vectors).toEqual([
        { key: 'k1', data: { float32: [0.1, 0.2] }, metadata: { blogId: 'p', snippet: 's' } }
      ]);
    });

    it('batches PutVectors at 500', async () => {
      const points = Array.from({ length: 1201 }, (_, i) => ({ id: `k${i}`, vector: [0], payload: {} }));

      await store.upsert('blog_content', points);

      expect(sent('PutVectors').map(c => c.input.vectors.length)).toEqual([500, 500, 201]);
    });

    it('sends nothing for an empty list', async () => {
      await store.upsert('blog_content', []);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('deletes', () => {
    it('deleteByIds batches at 500', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `k${i}`);

      await store.deleteByIds('blog_content', ids);

      expect(sent('DeleteVectors').map(c => c.input.keys.length)).toEqual([500, 1]);
    });

    it('deleteByPost deletes the full deterministic content key range', async () => {
      await store.deleteByPost('blog_content', 'p1');

      const keys = sent('DeleteVectors').flatMap(c => c.input.keys);
      expect(keys).toHaveLength(MAX_CONTENT_CHUNKS);
      expect(keys[0]).toBe(chunkId('p1', 0));
      expect(keys[MAX_CONTENT_CHUNKS - 1]).toBe(chunkId('p1', MAX_CONTENT_CHUNKS - 1));
      expect(new Set(keys).size).toBe(MAX_CONTENT_CHUNKS);
    });

    it('deleteByPost deletes the single title and summary keys', async () => {
      await store.deleteByPost('blog_titles', 'p1');
      await store.deleteByPost('blog_summaries', 'p1');

      expect(sent('DeleteVectors')[0].input).toEqual({ vectorBucketName: BUCKET, indexName: 'blog-titles', keys: [titleId('p1')] });
      expect(sent('DeleteVectors')[1].input).toEqual({ vectorBucketName: BUCKET, indexName: 'blog-summaries', keys: [summaryId('p1')] });
    });

    it('propagates delete errors', async () => {
      mockSend.mockRejectedValue(new Error('AccessDenied'));
      await expect(store.deleteByPost('blog_titles', 'p1')).rejects.toThrow('AccessDenied');
    });
  });

  describe('search', () => {
    it('maps similarity from cosine distance', async () => {
      mockSend.mockResolvedValue({
        vectors: [
          { key: 'a', distance: 0.1, metadata: { blogId: 'p1' } },
          { key: 'b', distance: 0.75, metadata: { blogId: 'p2' } }
        ]
      });

      const results = await store.search('blog_titles', [0.5, 0.5], 8);

      expect(sent('QueryVectors')[0].input).toEqual({
        vectorBucketName: BUCKET,
        indexName: 'blog-titles',
        topK: 8,
        queryVector: { float32: [0.5, 0.5] },
        returnMetadata: true,
        returnDistance: true
      });
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'a', score: expect.closeTo(0.9, 6), payload: { blogId: 'p1' } });
      expect(results[1].score).toBeCloseTo(0.25, 6);
    });

    it('returns [] when nothing matches', async () => {
      mockSend.mockResolvedValue({ vectors: [] });
      await expect(store.search('blog_titles', [1], 5)).resolves.toEqual([]);
    });
  });

  describe('listPostIds', () => {
    it('pages through blog-titles and yields metadata.blogId', async () => {
      mockSend
        .mockResolvedValueOnce({ vectors: [{ key: 'a', metadata: { blogId: 'p1' } }, { key: 'b', metadata: { blogId: 'p2' } }], nextToken: 'tok' })
        .mockResolvedValueOnce({ vectors: [{ key: 'c', metadata: { blogId: 'p3' } }] });

      const ids = [];
      for await (const id of store.listPostIds()) ids.push(id);

      expect(ids).toEqual(['p1', 'p2', 'p3']);
      const calls = sent('ListVectors');
      expect(calls[0].input).toEqual({ vectorBucketName: BUCKET, indexName: 'blog-titles', returnMetadata: true, maxResults: 500 });
      expect(calls[1].input).toEqual({ vectorBucketName: BUCKET, indexName: 'blog-titles', returnMetadata: true, maxResults: 500, nextToken: 'tok' });
    });

    it('skips vectors without a blogId', async () => {
      mockSend.mockResolvedValueOnce({ vectors: [{ key: 'a', metadata: {} }, { key: 'b' }] });

      const ids = [];
      for await (const id of store.listPostIds()) ids.push(id);

      expect(ids).toEqual([]);
    });
  });
});
