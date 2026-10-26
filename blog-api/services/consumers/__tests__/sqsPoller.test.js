jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('@aws-sdk/client-sqs', () => {
  class ReceiveMessageCommand { constructor(input) { this.input = input; } }
  class DeleteMessageBatchCommand { constructor(input) { this.input = input; } }
  return { SQSClient: jest.fn(), ReceiveMessageCommand, DeleteMessageBatchCommand };
});

const logger = require('../../../src/utils/logger');
const { SqsPoller } = require('../sqsPoller');

const QUEUE = 'https://sqs.ap-south-1.amazonaws.com/123456789012/indexing';
const msg = n => ({ MessageId: `m${n}`, ReceiptHandle: `r${n}`, Body: `{"n":${n}}`, Attributes: { ApproximateReceiveCount: '1' } });

// A fake SQS client keyed on the command class name. `receives` is consumed in order; when it runs out
// the next receive stays pending until the poller is stopped (aborted).
function fakeClient(receives) {
  const sent = [];
  const queue = [...receives];
  const client = {
    sent,
    send: jest.fn((command, options) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      if (name === 'ReceiveMessageCommand') {
        if (queue.length) return Promise.resolve({ Messages: queue.shift() });
        return new Promise((resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return Promise.resolve({ Successful: command.input.Entries?.map(e => ({ Id: e.Id })) });
    })
  };
  return client;
}
const sentOf = (client, name) => client.sent.filter(s => s.name === name);
const waitFor = async (predicate) => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(r => setImmediate(r));
};

describe('SqsPoller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests messages with the long-poll settings and the receive count attribute', async () => {
    const client = fakeClient([[]]);
    const poller = new SqsPoller({ queueUrl: QUEUE, handler: jest.fn(), client });

    poller.start();
    await waitFor(() => sentOf(client, 'ReceiveMessageCommand').length >= 2);
    await poller.stop();

    expect(sentOf(client, 'ReceiveMessageCommand')[0].input).toEqual({
      QueueUrl: QUEUE,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      MessageSystemAttributeNames: ['ApproximateReceiveCount']
    });
  });

  it('deletes only successfully handled messages', async () => {
    const client = fakeClient([[msg(1), msg(2), msg(3)]]);
    const handler = jest.fn(async m => { if (m.MessageId === 'm2') throw new Error('bad'); });
    const poller = new SqsPoller({ queueUrl: QUEUE, handler, client });

    poller.start();
    await waitFor(() => sentOf(client, 'DeleteMessageBatchCommand').length > 0);
    await poller.stop();

    const deletes = sentOf(client, 'DeleteMessageBatchCommand');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input).toEqual({
      QueueUrl: QUEUE,
      Entries: [{ Id: '0', ReceiptHandle: 'r1' }, { Id: '1', ReceiptHandle: 'r3' }]
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm2', receiveCount: '1', err: expect.any(Error) }),
      expect.any(String)
    );
  });

  it('does not call DeleteMessageBatch when every message fails', async () => {
    const client = fakeClient([[msg(1), msg(2)]]);
    const handler = jest.fn().mockRejectedValue(new Error('nope'));
    const poller = new SqsPoller({ queueUrl: QUEUE, handler, client });

    poller.start();
    await waitFor(() => handler.mock.calls.length === 2);
    await waitFor(() => sentOf(client, 'ReceiveMessageCommand').length >= 2);
    await poller.stop();

    expect(sentOf(client, 'DeleteMessageBatchCommand')).toHaveLength(0);
  });

  it('never runs more than `concurrency` handlers at once', async () => {
    const client = fakeClient([[msg(1), msg(2), msg(3), msg(4), msg(5)]]);
    let inFlight = 0;
    let peak = 0;
    const handler = jest.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setImmediate(r));
      inFlight--;
    });
    const poller = new SqsPoller({ queueUrl: QUEUE, handler, concurrency: 2, client });

    poller.start();
    await waitFor(() => sentOf(client, 'DeleteMessageBatchCommand').length > 0);
    await poller.stop();

    expect(peak).toBe(2);
    expect(sentOf(client, 'DeleteMessageBatchCommand')[0].input.Entries).toHaveLength(5);
  });

  it('stop ends the loop and no further receive is issued', async () => {
    const client = fakeClient([[msg(1)], []]);
    const poller = new SqsPoller({ queueUrl: QUEUE, handler: jest.fn().mockResolvedValue(), client });

    const loop = poller.start();
    await waitFor(() => sentOf(client, 'ReceiveMessageCommand').length === 3);
    const receivesBeforeStop = sentOf(client, 'ReceiveMessageCommand').length;
    await poller.stop();
    await expect(loop).resolves.toBeUndefined();

    expect(sentOf(client, 'ReceiveMessageCommand')).toHaveLength(receivesBeforeStop);
  });

  it('logs a receive error and keeps polling after a pause', async () => {
    jest.useFakeTimers();
    try {
      const client = fakeClient([]);
      client.send.mockRejectedValueOnce(new Error('throttled'));
      const poller = new SqsPoller({ queueUrl: QUEUE, handler: jest.fn(), client });

      poller.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.any(String));
      expect(client.send).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(4999);
      expect(client.send).toHaveBeenCalledTimes(1); // still paused

      await jest.advanceTimersByTimeAsync(1);
      expect(client.send).toHaveBeenCalledTimes(2);

      await poller.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
