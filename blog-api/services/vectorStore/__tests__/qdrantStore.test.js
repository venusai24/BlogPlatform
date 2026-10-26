const mockClient = {
  getCollections: jest.fn(),
  getCollection: jest.fn(),
  createCollection: jest.fn().mockResolvedValue({}),
  createPayloadIndex: jest.fn().mockResolvedValue({}),
  upsert: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
  search: jest.fn(),
  scroll: jest.fn()
};

jest.mock('@qdrant/js-client-rest', () => ({ QdrantClient: jest.fn(() => mockClient) }));

const store = require('../qdrantStore');

describe('qdrantStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.getCollections.mockResolvedValue({ collections: [] });
    mockClient.createCollection.mockResolvedValue({});
    mockClient.createPayloadIndex.mockResolvedValue({});
  });

  describe('ensureCollections', () => {
    it('creates missing collections with the configured dimension and cosine distance', async () => {
      await store.ensureCollections(384);

      expect(mockClient.createCollection).toHaveBeenCalledTimes(3);
      expect(mockClient.createCollection).toHaveBeenCalledWith('blog_titles', { vectors: { size: 384, distance: 'Cosine' } });
    });

    it('creates payload indexes', async () => {
      await store.ensureCollections(384);

      expect(mockClient.createPayloadIndex).toHaveBeenCalledTimes(3);
      for (const name of ['blog_titles', 'blog_content', 'blog_summaries']) {
        expect(mockClient.createPayloadIndex).toHaveBeenCalledWith(name, { field_name: 'blogId', field_schema: 'keyword', wait: true });
      }
    });

    it("ignores 'already exists' from createPayloadIndex", async () => {
      mockClient.createPayloadIndex.mockRejectedValue(new Error('Index Already Exists for field blogId'));
      await expect(store.ensureCollections(384)).resolves.not.toThrow();
    });

    it('rethrows any other createPayloadIndex error', async () => {
      mockClient.createPayloadIndex.mockRejectedValue(new Error('permission denied'));
      await expect(store.ensureCollections(384)).rejects.toThrow('permission denied');
    });

    it('rejects a collection whose dimension differs', async () => {
      mockClient.getCollections.mockResolvedValue({ collections: [{ name: 'blog_titles' }] });
      mockClient.getCollection.mockResolvedValue({ config: { params: { vectors: { size: 1024 } } } });

      await expect(store.ensureCollections(384)).rejects.toThrow('Qdrant dimension mismatch for blog_titles');
    });

    it('tolerates an unreachable Qdrant so the app can still start', async () => {
      mockClient.getCollections.mockRejectedValue(new Error('fetch failed'));

      await expect(store.ensureCollections(384)).resolves.toBeUndefined();
      expect(mockClient.createCollection).not.toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    it('upsert passes wait:true', async () => {
      const points = [{ id: 'a', vector: [1], payload: { blogId: 'p' } }];

      await store.upsert('blog_titles', points);

      expect(mockClient.upsert).toHaveBeenCalledWith('blog_titles', { wait: true, points });
    });

    it('deleteByIds passes wait:true', async () => {
      await store.deleteByIds('blog_content', ['a', 'b']);
      expect(mockClient.delete).toHaveBeenCalledWith('blog_content', { wait: true, points: ['a', 'b'] });
    });

    it('deleteByPost filters on blogId and passes wait:true', async () => {
      await store.deleteByPost('blog_content', 'p1');
      expect(mockClient.delete).toHaveBeenCalledWith('blog_content', {
        wait: true,
        filter: { must: [{ key: 'blogId', match: { value: 'p1' } }] }
      });
    });

    it('deleteByPost propagates errors', async () => {
      mockClient.delete.mockRejectedValueOnce(new Error('boom'));
      await expect(store.deleteByPost('blog_content', 'p1')).rejects.toThrow('boom');
    });
  });

  describe('reads', () => {
    it('search returns {id, score, payload}', async () => {
      mockClient.search.mockResolvedValue([{ id: 'a', score: 0.9, payload: { blogId: 'p' }, version: 1 }]);

      const results = await store.search('blog_titles', [0.1], 8);

      expect(mockClient.search).toHaveBeenCalledWith('blog_titles', { vector: [0.1], limit: 8, with_payload: true, with_vectors: false });
      expect(results).toEqual([{ id: 'a', score: 0.9, payload: { blogId: 'p' } }]);
    });

    it('listPostIds scrolls blog_titles and follows next_page_offset', async () => {
      mockClient.scroll
        .mockResolvedValueOnce({ points: [{ payload: { blogId: 'p1' } }, { payload: { blogId: 'p2' } }], next_page_offset: 'off1' })
        .mockResolvedValueOnce({ points: [{ payload: { blogId: 'p3' } }], next_page_offset: null });

      const ids = [];
      for await (const id of store.listPostIds()) ids.push(id);

      expect(ids).toEqual(['p1', 'p2', 'p3']);
      expect(mockClient.scroll).toHaveBeenNthCalledWith(1, 'blog_titles', { with_payload: ['blogId'], with_vector: false, limit: 256 });
      expect(mockClient.scroll).toHaveBeenNthCalledWith(2, 'blog_titles', { with_payload: ['blogId'], with_vector: false, limit: 256, offset: 'off1' });
    });
  });
});
