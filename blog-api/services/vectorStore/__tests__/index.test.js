jest.mock('@qdrant/js-client-rest', () => ({ QdrantClient: jest.fn() }));
jest.mock('@aws-sdk/client-s3vectors', () => ({ S3VectorsClient: jest.fn() }));

const config = require('../../../src/config');
const index = require('../index');
const qdrant = require('../qdrantStore');
const s3 = require('../s3VectorsStore');

describe('vector store selection', () => {
  const original = { read: config.vectorStore, write: config.vectorStoreWrite };
  beforeEach(() => {
    config.vectorStore = 'qdrant';
    config.vectorStoreWrite = 'primary';
  });
  afterEach(() => {
    config.vectorStore = original.read;
    config.vectorStoreWrite = original.write;
  });

  describe('getVectorStore', () => {
    it('returns the Qdrant store by default', () => {
      expect(index.getVectorStore()).toBe(qdrant);
    });

    it('returns the S3 Vectors store when VECTOR_STORE=s3vectors', () => {
      config.vectorStore = 's3vectors';
      expect(index.getVectorStore()).toBe(s3);
    });

    it('throws on an unknown backend', () => {
      config.vectorStore = 'faiss';
      expect(() => index.getVectorStore()).toThrow(/VECTOR_STORE/);
    });

    it.each(['qdrant', 's3vectors'])('the %s store exposes the full interface', (name) => {
      config.vectorStore = name;
      const store = index.getVectorStore();
      for (const method of ['ensureCollections', 'upsert', 'deleteByIds', 'deleteByPost', 'search', 'listPostIds']) {
        expect(typeof store[method]).toBe('function');
      }
    });
  });

  describe('getWriteStores', () => {
    it('writes only to the read store by default', () => {
      expect(index.getWriteStores()).toEqual([qdrant]);
      expect(index.getWriteStores()[0]).toBe(qdrant);
    });

    it('follows the read store when it is s3vectors', () => {
      config.vectorStore = 's3vectors';
      expect(index.getWriteStores()[0]).toBe(s3);
      expect(index.getWriteStores()).toHaveLength(1);
    });

    it('VECTOR_STORE_WRITE=both writes to Qdrant and S3 Vectors', () => {
      config.vectorStoreWrite = 'both';
      const stores = index.getWriteStores();
      expect(stores).toHaveLength(2);
      expect(stores[0]).toBe(qdrant);
      expect(stores[1]).toBe(s3);
    });
  });

  describe('getEnsureStores', () => {
    it('includes every store that is read or written', () => {
      config.vectorStoreWrite = 'both';
      const stores = index.getEnsureStores();
      expect(stores).toHaveLength(2);
      expect(stores).toContain(qdrant);
      expect(stores).toContain(s3);
    });

    it('is just the read store by default', () => {
      const stores = index.getEnsureStores();
      expect(stores).toHaveLength(1);
      expect(stores[0]).toBe(qdrant);
    });
  });
});

// useOnlyStore is process-wide state, so it gets its own module registry.
describe('useOnlyStore', () => {
  function fresh() {
    let mod;
    jest.isolateModules(() => {
      mod = { index: require('../index'), config: require('../../../src/config') };
    });
    return mod;
  }

  it('forces writes to one store, for backfills', () => {
    const { index: fresh1, config: cfg } = fresh();
    cfg.vectorStoreWrite = 'both';
    expect(fresh1.getWriteStores()).toHaveLength(2);

    fresh1.useOnlyStore('s3vectors');
    const [only] = fresh1.getWriteStores();
    expect(fresh1.getWriteStores()).toHaveLength(1);
    expect(typeof only.search).toBe('function');
    expect(only).not.toBe(require('../qdrantStore'));
  });

  it('rejects an unknown store', () => {
    expect(() => fresh().index.useOnlyStore('faiss')).toThrow(/Unknown store/);
  });
});
