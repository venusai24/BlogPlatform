const mockConnect = jest.fn();

// Undo the global jest.setup.js mock so the real module is under test.
jest.unmock('../dbConn');
jest.mock('mongoose', () => ({ connect: (...args) => mockConnect(...args) }));

describe('config/dbConn', () => {
  beforeEach(() => mockConnect.mockReset());

  it('connects with only maxPoolSize from config', async () => {
    mockConnect.mockResolvedValue();
    const connectDB = require('../dbConn');

    await connectDB();

    expect(mockConnect).toHaveBeenCalledWith('mongodb://localhost:27017/test', { maxPoolSize: 10 });
  });

  it('logs and rethrows when the connection fails', async () => {
    mockConnect.mockRejectedValue(new Error('refused'));
    const connectDB = require('../dbConn');

    await expect(connectDB()).rejects.toThrow('refused');
  });
});
