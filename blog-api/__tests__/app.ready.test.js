const request = require('supertest');

const mockGetCollections = jest.fn();

jest.mock('../services/qdrantService', () => ({
  initQdrant: jest.fn(),
  getQdrantClient: jest.fn(() => ({ getCollections: mockGetCollections }))
}));
jest.mock('../services/redisClient', () => ({
  ping: jest.fn(),
  isReady: true,
  isOpen: true,
  get: jest.fn(),
  set: jest.fn(),
  connect: jest.fn(),
  quit: jest.fn()
}));
jest.mock('../socket', () => ({ init: jest.fn(), getIO: jest.fn(), isAdapterReady: jest.fn(() => false) }));

const app = require('../app');

describe('GET /ready', () => {
  it('checks Qdrant through the shared client and reports the socket adapter without depending on it', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });

    const res = await request(app).get('/ready');

    expect(mockGetCollections).toHaveBeenCalled();
    expect(res.body.qdrant).toBe(true);
    expect(res.body).toHaveProperty('socketAdapter', false);
    // mongo is not connected under jest, so the overall status is 503 for that reason only.
    expect(res.body.redis).toBe(true);
  });
});
