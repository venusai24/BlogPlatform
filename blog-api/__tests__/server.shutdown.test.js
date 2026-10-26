const mockSummarizeFactory = jest.fn(() => ({ close: jest.fn().mockResolvedValue() }));
const mockIndexingFactory = jest.fn(() => ({ close: jest.fn().mockResolvedValue() }));
const mockIoClose = jest.fn(cb => cb && cb());

jest.mock('../app', () => (req, res) => res.end());
jest.mock('../services/summarizeWorker', () => mockSummarizeFactory());
jest.mock('../services/indexingWorker', () => mockIndexingFactory());
jest.mock('../socket', () => ({
  init: jest.fn(() => ({ on: jest.fn(), close: mockIoClose }))
}));
jest.mock('mongoose', () => ({ connection: { close: jest.fn().mockResolvedValue() } }));
jest.mock('../services/redisClient', () => ({ isOpen: true, quit: jest.fn().mockResolvedValue() }));

describe('server shutdown', () => {
  let exitSpy;
  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    mockIoClose.mockClear();
  });
  afterEach(() => {
    exitSpy.mockRestore();
    delete process.env.RUN_WORKERS;
  });

  it('closes workers before Mongo, then Redis, then exits 0', async () => {
    const { shutdown, workers } = require('../server');
    const mongoose = require('mongoose');
    const redisClient = require('../services/redisClient');
    expect(workers).toHaveLength(2);

    await shutdown('SIGTERM');

    const workerOrders = workers.map(w => w.close.mock.invocationCallOrder[0]);
    const mongoOrder = mongoose.connection.close.mock.invocationCallOrder[0];
    const redisOrder = redisClient.quit.mock.invocationCallOrder[0];
    for (const order of workerOrders) {
      expect(order).toBeLessThan(mongoOrder);
    }
    expect(mongoOrder).toBeLessThan(redisOrder);
    expect(mongoose.connection.close).toHaveBeenCalledWith(false);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('closes socket.io (which also closes the HTTP server)', async () => {
    const { shutdown } = require('../server');

    await shutdown('SIGTERM');

    expect(mockIoClose).toHaveBeenCalledTimes(1);
  });

  it('still closes Mongo and exits 0 when a worker fails to close', async () => {
    const { shutdown, workers } = require('../server');
    const mongoose = require('mongoose');
    workers[0].close.mockRejectedValueOnce(new Error('stuck'));

    await shutdown('SIGINT');

    expect(mongoose.connection.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('RUN_WORKERS=false loads no workers', () => {
    process.env.RUN_WORKERS = 'false';
    mockSummarizeFactory.mockClear();
    mockIndexingFactory.mockClear();

    let mod;
    jest.isolateModules(() => {
      mod = require('../server');
    });

    expect(mod.workers).toHaveLength(0);
    expect(mockSummarizeFactory).not.toHaveBeenCalled();
    expect(mockIndexingFactory).not.toHaveBeenCalled();
  });
});
