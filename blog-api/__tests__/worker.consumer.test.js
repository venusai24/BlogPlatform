const mockStart = jest.fn();
const mockStop = jest.fn().mockResolvedValue();
const mockPollerCtor = jest.fn(() => ({ start: mockStart, stop: mockStop }));

jest.mock('../config/dbConn', () => jest.fn().mockResolvedValue());
jest.mock('../services/summarizeWorker', () => ({ close: jest.fn().mockResolvedValue() }));
jest.mock('../services/indexingWorker', () => ({ close: jest.fn().mockResolvedValue() }));
jest.mock('mongoose', () => ({ connection: { close: jest.fn().mockResolvedValue() } }));
jest.mock('../services/redisClient', () => ({ isOpen: false, quit: jest.fn() }));
jest.mock('../services/consumers/sqsPoller', () => ({ SqsPoller: function (...args) { return mockPollerCtor(...args); } }));
jest.mock('../services/consumers/indexingConsumer', () => ({ handle: jest.fn().mockResolvedValue() }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe('worker.start with the indexing consumer', () => {
  const config = require('../src/config');
  const original = { mode: config.indexingConsumerMode, url: config.indexingQueueUrl, runtime: config.indexingConsumerRuntime };
  let worker;
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.isolateModules(() => {
      worker = require('../src/worker');
    });
  });
  afterEach(() => {
    config.indexingConsumerMode = original.mode;
    config.indexingQueueUrl = original.url;
    config.indexingConsumerRuntime = original.runtime;
    exitSpy.mockRestore();
  });

  it('does not start a poller when the mode is off', async () => {
    config.indexingConsumerMode = 'off';

    const state = await worker.start();

    expect(mockPollerCtor).not.toHaveBeenCalled();
    expect(state.loops).toHaveLength(0);
  });

  it.each(['shadow', 'active'])('exits 1 in %s mode without INDEXING_QUEUE_URL', async (mode) => {
    config.indexingConsumerMode = mode;
    config.indexingQueueUrl = '';

    await worker.start();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockPollerCtor).not.toHaveBeenCalled();
  });

  it.each(['shadow', 'active'])('starts a poller in %s mode and registers it as a loop', async (mode) => {
    config.indexingConsumerMode = mode;
    config.indexingQueueUrl = 'https://sqs.ap-south-1.amazonaws.com/1/indexing';

    const state = await worker.start();

    expect(mockPollerCtor).toHaveBeenCalledWith(expect.objectContaining({
      queueUrl: 'https://sqs.ap-south-1.amazonaws.com/1/indexing',
      handler: expect.any(Function)
    }));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(state.loops).toHaveLength(1);

    await state.loops[0].stop();
    expect(mockStop).toHaveBeenCalled();
  });

  it('the handler passes the configured mode to the consumer', async () => {
    config.indexingConsumerMode = 'shadow';
    config.indexingQueueUrl = 'https://sqs.example/q';
    const { handle } = require('../services/consumers/indexingConsumer');

    await worker.start();
    const { handler } = mockPollerCtor.mock.calls[0][0];
    await handler({ Body: '{}' });

    expect(handle).toHaveBeenCalledWith({ Body: '{}' }, 'shadow');
  });

  it('does not start the SQS poller when the runtime is lambda', async () => {
    config.indexingConsumerMode = 'active';
    config.indexingQueueUrl = 'https://sqs.example/q';
    config.indexingConsumerRuntime = 'lambda';

    const state = await worker.start();

    expect(mockPollerCtor).not.toHaveBeenCalled();
    expect(state.loops).toHaveLength(0);
  });

  it('does not require INDEXING_QUEUE_URL when the runtime is lambda', async () => {
    config.indexingConsumerMode = 'active';
    config.indexingQueueUrl = '';
    config.indexingConsumerRuntime = 'lambda';

    await worker.start();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('still starts the poller on the ecs runtime', async () => {
    config.indexingConsumerMode = 'active';
    config.indexingQueueUrl = 'https://sqs.example/q';
    config.indexingConsumerRuntime = 'ecs';

    const state = await worker.start();

    expect(mockPollerCtor).toHaveBeenCalledTimes(1);
    expect(state.loops).toHaveLength(1);
  });
});
