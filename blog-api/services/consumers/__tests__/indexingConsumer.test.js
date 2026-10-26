jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../indexing/postIndexer', () => ({ reconcilePost: jest.fn() }));
jest.mock('../../../src/utils/metrics', () => ({ emitMetric: jest.fn() }));

const logger = require('../../../src/utils/logger');
const postIndexer = require('../../indexing/postIndexer');
const { emitMetric } = require('../../../src/utils/metrics');
const { handle, PoisonMessageError } = require('../indexingConsumer');

const POST_ID = '64b7f0c2a1b2c3d4e5f60718';
const message = (overrides = {}) => ({
  Body: JSON.stringify({
    specversion: '1.0',
    id: '64b7f0c2a1b2c3d4e5f60999',
    type: 'blog.post.updated',
    source: 'blog-api',
    subject: POST_ID,
    data: { postId: POST_ID, revision: 2 },
    ...overrides
  })
});

describe('indexingConsumer.handle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postIndexer.reconcilePost.mockResolvedValue({ action: 'indexed' });
  });

  it('shadow mode does not reconcile, it only logs what it would do', async () => {
    await handle(message(), 'shadow');

    expect(postIndexer.reconcilePost).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { eventId: '64b7f0c2a1b2c3d4e5f60999', type: 'blog.post.updated', postId: POST_ID },
      'shadow: would reconcile post'
    );
  });

  it('active mode reconciles the post id from the envelope', async () => {
    await handle(message(), 'active');

    expect(postIndexer.reconcilePost).toHaveBeenCalledWith(POST_ID);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ postId: POST_ID, action: 'indexed' }), expect.any(String));
  });

  it('active mode handles a deleted event the same way (reconcile removes the vectors)', async () => {
    postIndexer.reconcilePost.mockResolvedValue({ action: 'removed' });

    await handle(message({ type: 'blog.post.deleted' }), 'active');

    expect(postIndexer.reconcilePost).toHaveBeenCalledWith(POST_ID);
  });

  it('active mode lets reconcile errors propagate so SQS retries the message', async () => {
    postIndexer.reconcilePost.mockRejectedValue(new Error('embed failed'));
    await expect(handle(message(), 'active')).rejects.toThrow('embed failed');
  });

  it('malformed JSON throws PoisonMessageError', async () => {
    await expect(handle({ Body: '{not json' }, 'active')).rejects.toBeInstanceOf(PoisonMessageError);
  });

  it('unknown event type throws PoisonMessageError', async () => {
    await expect(handle(message({ type: 'blog.post.exploded' }), 'active')).rejects.toBeInstanceOf(PoisonMessageError);
  });

  it.each([
    ['missing', undefined],
    ['not hex', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
    ['too short', 'abc123'],
    ['not a string', 12345]
  ])('a %s postId throws PoisonMessageError', async (_label, postId) => {
    await expect(handle(message({ data: { postId, revision: 1 } }), 'active')).rejects.toBeInstanceOf(PoisonMessageError);
    expect(postIndexer.reconcilePost).not.toHaveBeenCalled();
  });

  it('a body with no data object throws PoisonMessageError', async () => {
    await expect(handle(message({ data: undefined }), 'active')).rejects.toBeInstanceOf(PoisonMessageError);
  });

  it('PoisonMessageError is an Error with a name', () => {
    const err = new PoisonMessageError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PoisonMessageError');
  });

  describe('metrics', () => {
    it('active mode emits IndexingSucceeded', async () => {
      await handle(message(), 'active');
      expect(emitMetric).toHaveBeenCalledWith('IndexingSucceeded', 1);
      expect(emitMetric).not.toHaveBeenCalledWith('IndexingFailed', expect.anything());
    });

    it('a reconcile error emits IndexingFailed and still rejects', async () => {
      postIndexer.reconcilePost.mockRejectedValue(new Error('embed failed'));

      await expect(handle(message(), 'active')).rejects.toThrow('embed failed');

      expect(emitMetric).toHaveBeenCalledWith('IndexingFailed', 1);
      expect(emitMetric).not.toHaveBeenCalledWith('IndexingSucceeded', expect.anything());
    });

    it('a poison message emits IndexingFailed', async () => {
      await expect(handle({ Body: 'nope' }, 'active')).rejects.toBeInstanceOf(PoisonMessageError);
      expect(emitMetric).toHaveBeenCalledWith('IndexingFailed', 1);
    });

    it('shadow mode emits no indexing metric', async () => {
      await handle(message(), 'shadow');
      expect(emitMetric).not.toHaveBeenCalled();
    });
  });
});
