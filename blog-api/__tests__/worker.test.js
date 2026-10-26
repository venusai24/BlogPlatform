const mockDbConn = jest.fn().mockResolvedValue();
const mockSummarizeWorker = { close: jest.fn().mockResolvedValue() };
const mockIndexingWorker = { close: jest.fn().mockResolvedValue() };

jest.mock('../config/dbConn', () => mockDbConn);
jest.mock('../services/summarizeWorker', () => mockSummarizeWorker);
jest.mock('../services/indexingWorker', () => mockIndexingWorker);
jest.mock('mongoose', () => ({ connection: { close: jest.fn().mockResolvedValue() } }));
jest.mock('../services/redisClient', () => ({ isOpen: true, quit: jest.fn().mockResolvedValue() }));

describe('src/worker', () => {
  let worker;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      worker = require('../src/worker');
    });
  });

  it('start connects to Mongo and starts both workers', async () => {
    const state = await worker.start();

    expect(mockDbConn).toHaveBeenCalledTimes(1);
    expect(state.workers).toHaveLength(2);
    expect(state.workers).toEqual([mockSummarizeWorker, mockIndexingWorker]);
    expect(state.loops).toEqual([]);
  });

  it('start fails (so the process exits) when Mongo cannot connect', async () => {
    mockDbConn.mockRejectedValueOnce(new Error('no mongo'));
    await expect(worker.start()).rejects.toThrow('no mongo');
  });

  it('stop closes workers then Mongo then Redis', async () => {
    const mongoose = require('mongoose');
    const redisClient = require('../services/redisClient');
    await worker.start();

    await worker.stop();

    const orders = [
      mockSummarizeWorker.close.mock.invocationCallOrder[0],
      mockIndexingWorker.close.mock.invocationCallOrder[0]
    ];
    const mongoOrder = mongoose.connection.close.mock.invocationCallOrder[0];
    const redisOrder = redisClient.quit.mock.invocationCallOrder[0];
    for (const order of orders) {
      expect(order).toBeLessThan(mongoOrder);
    }
    expect(mongoOrder).toBeLessThan(redisOrder);
  });

  it('stop runs registered loops first', async () => {
    const state = await worker.start();
    const stopLoop = jest.fn().mockResolvedValue();
    state.loops.push({ stop: stopLoop });

    await worker.stop();

    expect(stopLoop).toHaveBeenCalledTimes(1);
    expect(stopLoop.mock.invocationCallOrder[0]).toBeLessThan(mockSummarizeWorker.close.mock.invocationCallOrder[0]);
  });
});
