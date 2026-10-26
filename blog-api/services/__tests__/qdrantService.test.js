const mockEnsure = jest.fn();
const mockGetClient = jest.fn(() => ({ marker: 'client' }));

const mockSecondEnsure = jest.fn();
let mockStores;

jest.mock('../vectorStore', () => ({ getEnsureStores: () => mockStores }));
jest.mock('../vectorStore/qdrantStore', () => ({ getClient: () => mockGetClient() }));

const { initQdrant, getQdrantClient } = require('../qdrantService');

describe('qdrantService', () => {
  beforeEach(() => {
    mockEnsure.mockReset().mockResolvedValue();
    mockSecondEnsure.mockReset().mockResolvedValue();
    mockStores = [{ ensureCollections: mockEnsure }];
  });

  it('initQdrant delegates to the vector store with EMBEDDING_DIM', async () => {
    await initQdrant();
    expect(mockEnsure).toHaveBeenCalledWith(384);
  });

  it('initQdrant rethrows store errors', async () => {
    mockEnsure.mockRejectedValue(new Error('dimension mismatch'));
    await expect(initQdrant()).rejects.toThrow('dimension mismatch');
  });

  it('getQdrantClient still returns the shared client', () => {
    expect(getQdrantClient()).toEqual({ marker: 'client' });
  });

  it('verifies every store that is read or written', async () => {
    mockStores = [{ ensureCollections: mockEnsure }, { ensureCollections: mockSecondEnsure }];

    await initQdrant();

    expect(mockEnsure).toHaveBeenCalledWith(384);
    expect(mockSecondEnsure).toHaveBeenCalledWith(384);
  });
});
