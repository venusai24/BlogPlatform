const mockAdapterSetter = jest.fn();
const mockPub = { connect: jest.fn().mockResolvedValue(), duplicate: jest.fn() };
const mockSub = { connect: jest.fn().mockResolvedValue() };
mockPub.duplicate.mockReturnValue(mockSub);

jest.mock('redis', () => ({ createClient: jest.fn(() => mockPub) }));
jest.mock('socket.io', () => jest.fn(() => ({ adapter: mockAdapterSetter })));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn(() => 'adapter') }));

describe('socket.init', () => {
  it('builds the pub/sub clients from nodeRedisOptions and reports adapter readiness', async () => {
    const { createClient } = require('redis');
    const socket = require('../socket');
    expect(socket.isAdapterReady()).toBe(false);

    socket.init({});
    await new Promise(resolve => setImmediate(resolve));

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      url: 'redis://localhost:6379',
      socket: expect.any(Object)
    }));
    expect(mockAdapterSetter).toHaveBeenCalledWith('adapter');
    expect(socket.isAdapterReady()).toBe(true);
  });

  it('stays not-ready when the adapter cannot connect', async () => {
    mockPub.connect.mockRejectedValueOnce(new Error('down'));
    let socket;
    jest.isolateModules(() => {
      socket = require('../socket');
    });
    socket.init({});
    await new Promise(resolve => setImmediate(resolve));

    expect(socket.isAdapterReady()).toBe(false);
  });
});
