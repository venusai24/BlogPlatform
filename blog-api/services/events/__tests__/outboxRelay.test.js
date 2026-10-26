const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
  PublishCommand: jest.fn(input => ({ input }))
}));
jest.mock('../../../model/Outbox', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
  countDocuments: jest.fn().mockResolvedValue(0)
}));
jest.mock('../../../src/utils/metrics', () => ({ emitMetric: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const Outbox = require('../../../model/Outbox');
const logger = require('../../../src/utils/logger');
const { emitMetric } = require('../../../src/utils/metrics');
const config = require('../../../src/config');
const relay = require('../outboxRelay');

const NOW = new Date('2026-01-01T00:00:00.000Z');
const TOPIC = 'arn:aws:sns:ap-south-1:123456789012:domain-events';
const doc = (overrides = {}) => ({
  _id: 'o1',
  attempts: 1,
  envelope: { id: 'o1', type: 'blog.post.created', data: { postId: 'p', revision: 1 } },
  ...overrides
});

describe('outboxRelay', () => {
  const originalTopic = config.domainEventsTopicArn;
  const originalPoll = config.outboxPollMs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    Outbox.updateOne.mockResolvedValue({});
    config.domainEventsTopicArn = TOPIC;
  });
  afterEach(() => {
    config.domainEventsTopicArn = originalTopic;
    config.outboxPollMs = originalPoll;
  });

  describe('fault injection', () => {
    const originalFaults = { ...config.faults };
    afterEach(() => { config.faults = { ...originalFaults }; });

    it('paused relay claims nothing', async () => {
      config.faults = { ...originalFaults, relayPause: true };

      const result = await relay.runOnce(NOW);

      expect(result).toEqual({ published: 0, failed: 0, paused: true });
      expect(Outbox.findOneAndUpdate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('resumes publishing once the pause is lifted', async () => {
      config.faults = { ...originalFaults, relayPause: true };
      await relay.runOnce(NOW);
      config.faults = { ...originalFaults };
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(null);

      const result = await relay.runOnce(NOW);

      expect(result).toEqual({ published: 1, failed: 0 });
    });
  });

  describe('claimNext', () => {
    it('claims with the pending/lease filter', async () => {
      Outbox.findOneAndUpdate.mockResolvedValue(null);

      await relay.claimNext(NOW);

      expect(Outbox.findOneAndUpdate).toHaveBeenCalledWith(
        {
          status: 'pending',
          nextAttemptAt: { $lte: NOW },
          $or: [{ lockedUntil: null }, { lockedUntil: { $lt: NOW } }]
        },
        { $set: { lockedUntil: new Date(NOW.getTime() + 30000) }, $inc: { attempts: 1 } },
        { sort: { _id: 1 }, new: true }
      );
    });
  });

  describe('runOnce', () => {
    it('publishes the envelope with an eventType attribute', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(null);

      await relay.runOnce(NOW);

      const { PublishCommand } = require('@aws-sdk/client-sns');
      expect(PublishCommand).toHaveBeenCalledWith({
        TopicArn: TOPIC,
        Message: JSON.stringify(doc().envelope),
        MessageAttributes: { eventType: { DataType: 'String', StringValue: 'blog.post.created' } }
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('marks published on success', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(null);

      const result = await relay.runOnce(NOW);

      expect(Outbox.updateOne).toHaveBeenCalledWith(
        { _id: 'o1' },
        { $set: { status: 'published', publishedAt: NOW, lockedUntil: null, lastError: null } }
      );
      expect(result).toEqual({ published: 1, failed: 0 });
    });

    it.each([
      [1, 2000],
      [3, 8000],
      [9, 300000]
    ])('backs off exponentially on failure: attempts=%i -> +%ims (capped at 300000)', async (attempts, delay) => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc({ attempts })).mockResolvedValueOnce(null);
      mockSend.mockRejectedValue(new Error('sns down'));

      const result = await relay.runOnce(NOW);

      expect(Outbox.updateOne).toHaveBeenCalledWith(
        { _id: 'o1' },
        { $set: { lockedUntil: null, lastError: 'sns down', nextAttemptAt: new Date(NOW.getTime() + delay) } }
      );
      expect(result).toEqual({ published: 0, failed: 1 });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('truncates long error messages to 500 characters', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(null);
      mockSend.mockRejectedValue(new Error('x'.repeat(900)));

      await relay.runOnce(NOW);

      expect(Outbox.updateOne.mock.calls[0][1].$set.lastError).toHaveLength(500);
    });

    it('logs at error level once a record has failed 10 times', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc({ attempts: 10 })).mockResolvedValueOnce(null);
      mockSend.mockRejectedValue(new Error('still down'));

      await relay.runOnce(NOW);

      expect(logger.error).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('stops when nothing is pending: doc, doc, null -> 2 publishes', async () => {
      Outbox.findOneAndUpdate
        .mockResolvedValueOnce(doc({ _id: 'a' }))
        .mockResolvedValueOnce(doc({ _id: 'b' }))
        .mockResolvedValueOnce(null);

      const result = await relay.runOnce(NOW);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result.published).toBe(2);
    });

    it('stops after max claims', async () => {
      Outbox.findOneAndUpdate.mockResolvedValue(doc());

      const result = await relay.runOnce(NOW, 3);

      expect(Outbox.findOneAndUpdate).toHaveBeenCalledTimes(3);
      expect(result.published).toBe(3);
    });
  });

  describe('metrics', () => {
    it('emits OutboxPublishFailed for each failed publish', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(doc({ _id: 'o2' })).mockResolvedValueOnce(null);
      mockSend.mockRejectedValue(new Error('sns down'));

      await relay.runOnce(NOW);

      expect(emitMetric).toHaveBeenCalledTimes(2);
      expect(emitMetric).toHaveBeenCalledWith('OutboxPublishFailed', 1);
    });

    it('emits no failure metric when publishing succeeds', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(null);

      await relay.runOnce(NOW);

      expect(emitMetric).not.toHaveBeenCalled();
    });

    describe('OutboxPending gauge', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(async () => {
        await relay.stop();
        jest.useRealTimers();
      });

      it('reports the pending count every 60 seconds', async () => {
        Outbox.findOneAndUpdate.mockResolvedValue(null);
        Outbox.countDocuments.mockResolvedValue(7);

        relay.start();
        await jest.advanceTimersByTimeAsync(0);
        expect(Outbox.countDocuments).toHaveBeenCalledWith({ status: 'pending' });
        expect(emitMetric).toHaveBeenCalledWith('OutboxPending', 7);

        emitMetric.mockClear();
        await jest.advanceTimersByTimeAsync(59000);
        expect(emitMetric).not.toHaveBeenCalledWith('OutboxPending', expect.anything());
        await jest.advanceTimersByTimeAsync(1000);
        expect(emitMetric).toHaveBeenCalledWith('OutboxPending', 7);
      });

      it('stops reporting after stop()', async () => {
        Outbox.findOneAndUpdate.mockResolvedValue(null);
        relay.start();
        await jest.advanceTimersByTimeAsync(0);
        await relay.stop();
        Outbox.countDocuments.mockClear();

        await jest.advanceTimersByTimeAsync(5 * 60000);

        expect(Outbox.countDocuments).not.toHaveBeenCalled();
      });

      it('a failing count is logged and does not break polling', async () => {
        config.outboxPollMs = 1000;
        Outbox.findOneAndUpdate.mockResolvedValue(null);
        Outbox.countDocuments.mockRejectedValue(new Error('mongo blip'));

        relay.start();
        await jest.advanceTimersByTimeAsync(2000);

        expect(Outbox.findOneAndUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe('start / stop', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(async () => {
      await relay.stop();
      jest.useRealTimers();
    });

    it('polls repeatedly at outboxPollMs', async () => {
      config.outboxPollMs = 1000;
      Outbox.findOneAndUpdate.mockResolvedValue(null);

      relay.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(Outbox.findOneAndUpdate).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);
      expect(Outbox.findOneAndUpdate).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1000);
      expect(Outbox.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });

    it('stop clears the timer and waits for the in-flight run', async () => {
      let release;
      Outbox.findOneAndUpdate.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null); }));

      relay.start();
      await jest.advanceTimersByTimeAsync(0);

      let stopped = false;
      const stopping = relay.stop().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);

      release();
      await stopping;
      expect(stopped).toBe(true);

      Outbox.findOneAndUpdate.mockClear();
      await jest.advanceTimersByTimeAsync(5000);
      expect(Outbox.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('survives a failing tick and keeps polling', async () => {
      config.outboxPollMs = 1000;
      Outbox.findOneAndUpdate.mockRejectedValueOnce(new Error('mongo blip')).mockResolvedValue(null);

      relay.start();
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(1000);

      expect(Outbox.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

describe('worker.start with the relay', () => {
  let worker;
  let relayModule;
  let exitSpy;
  const originals = {};

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../config/dbConn', () => jest.fn().mockResolvedValue());
    jest.doMock('../../summarizeWorker', () => ({ close: jest.fn().mockResolvedValue() }));
    jest.doMock('../../indexingWorker', () => ({ close: jest.fn().mockResolvedValue() }));
    jest.doMock('mongoose', () => ({ connection: { close: jest.fn().mockResolvedValue() } }));
    jest.doMock('../../redisClient', () => ({ isOpen: false, quit: jest.fn() }));
    jest.doMock('../../../model/Outbox', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue(null), updateOne: jest.fn() }));
    jest.doMock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const cfg = require('../../../src/config');
    for (const k of ['outboxRelayEnabled', 'domainEventsTopicArn']) originals[k] = cfg[k];
    worker = require('../../../src/worker');
    relayModule = require('../outboxRelay');
  });
  afterEach(async () => {
    const cfg = require('../../../src/config');
    Object.assign(cfg, originals);
    await relayModule.stop();
    exitSpy.mockRestore();
    jest.dontMock('../../../config/dbConn');
  });

  it('exits when the relay is enabled without a topic ARN', async () => {
    const cfg = require('../../../src/config');
    cfg.outboxRelayEnabled = true;
    cfg.domainEventsTopicArn = undefined;

    await worker.start();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(require('../../../src/utils/logger').error).toHaveBeenCalled();
  });

  it('registers the relay as a loop when enabled with a topic ARN', async () => {
    const cfg = require('../../../src/config');
    cfg.outboxRelayEnabled = true;
    cfg.domainEventsTopicArn = TOPIC;

    const state = await worker.start();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(state.loops).toHaveLength(1);
    expect(typeof state.loops[0].stop).toBe('function');
  });

  it('does not start the relay when disabled', async () => {
    const cfg = require('../../../src/config');
    cfg.outboxRelayEnabled = false;

    const state = await worker.start();

    expect(state.loops).toHaveLength(0);
  });
});
