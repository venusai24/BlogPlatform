const mockStoreIds = [];

jest.mock('../../redisClient', () => ({ set: jest.fn(), get: jest.fn(), del: jest.fn() }));
jest.mock('../../../model/BlogContent', () => ({ find: jest.fn(), exists: jest.fn() }));
jest.mock('../postIndexer', () => ({ reconcilePost: jest.fn(), removePost: jest.fn() }));
jest.mock('../../vectorStore', () => ({
  getVectorStore: () => ({
    listPostIds: async function* () {
      for (const id of mockStoreIds) yield id;
    }
  })
}));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const redisClient = require('../../redisClient');
const BlogContent = require('../../../model/BlogContent');
const postIndexer = require('../postIndexer');
const logger = require('../../../src/utils/logger');
const { runSweep } = require('../reconciler');

const A = '64b7f0c2a1b2c3d4e5f60001';
const B = '64b7f0c2a1b2c3d4e5f60002';
const C = '64b7f0c2a1b2c3d4e5f60003';
const GONE = '64b7f0c2a1b2c3d4e5f6ffff';

const post = (id, revision, indexedRevision) => ({ _id: { toString: () => id }, revision, indexedRevision });

// BlogContent.find(...).lean().cursor() is an async iterable over the posts.
function givenPosts(posts) {
  BlogContent.find.mockReturnValue({
    lean: () => ({
      cursor: () => (async function* () { for (const p of posts) yield p; })()
    })
  });
}

describe('reconciler.runSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreIds.length = 0;
    redisClient.set.mockResolvedValue('OK');
    redisClient.get.mockImplementation(async () => redisClient.set.mock.calls[0]?.[1]);
    redisClient.del.mockResolvedValue(1);
    postIndexer.reconcilePost.mockResolvedValue({ action: 'indexed' });
    postIndexer.removePost.mockResolvedValue();
    BlogContent.exists.mockResolvedValue({ _id: 'x' });
    givenPosts([]);
  });

  it('reconciles stale posts', async () => {
    givenPosts([
      post(A, 3, 3),          // up to date
      post(B, 4, 3),          // behind
      post(C, undefined, undefined) // legacy: never indexed
    ]);
    mockStoreIds.push(A, B, C);

    const result = await runSweep({ dryRun: false });

    expect(result).toEqual({ stale: 2, orphans: 0, fixed: 2 });
    expect(postIndexer.reconcilePost).toHaveBeenCalledTimes(2);
    expect(postIndexer.reconcilePost).toHaveBeenCalledWith(B);
    expect(postIndexer.reconcilePost).toHaveBeenCalledWith(C);
    expect(postIndexer.reconcilePost).not.toHaveBeenCalledWith(A);
  });

  it('asks Mongo only for the fields it needs', async () => {
    await runSweep({ dryRun: false });
    expect(BlogContent.find).toHaveBeenCalledWith({}, { _id: 1, revision: 1, indexedRevision: 1 });
  });

  it('removes orphaned vectors', async () => {
    givenPosts([post(A, 1, 1)]);
    mockStoreIds.push(A, GONE);
    BlogContent.exists.mockImplementation(async ({ _id }) => (_id === GONE ? null : { _id }));

    const result = await runSweep({ dryRun: false });

    expect(result).toEqual({ stale: 0, orphans: 1, fixed: 1 });
    expect(postIndexer.removePost).toHaveBeenCalledTimes(1);
    expect(postIndexer.removePost).toHaveBeenCalledWith(GONE);
  });

  it('treats a vector whose blogId is not a valid ObjectId as an orphan without querying Mongo', async () => {
    mockStoreIds.push('not-an-object-id');

    const result = await runSweep({ dryRun: false });

    expect(result.orphans).toBe(1);
    expect(BlogContent.exists).not.toHaveBeenCalled();
    expect(postIndexer.removePost).toHaveBeenCalledWith('not-an-object-id');
  });

  it('dry run changes nothing but still reports the counts', async () => {
    givenPosts([post(B, 4, 3)]);
    mockStoreIds.push(GONE);
    BlogContent.exists.mockResolvedValue(null);

    const result = await runSweep({ dryRun: true });

    expect(result).toEqual({ stale: 1, orphans: 1, fixed: 0 });
    expect(postIndexer.reconcilePost).not.toHaveBeenCalled();
    expect(postIndexer.removePost).not.toHaveBeenCalled();
  });

  it('defaults to a dry run', async () => {
    givenPosts([post(B, 4, 3)]);

    const result = await runSweep();

    expect(result.fixed).toBe(0);
    expect(postIndexer.reconcilePost).not.toHaveBeenCalled();
  });

  it('skips when the lock is held', async () => {
    redisClient.set.mockResolvedValue(null);

    const result = await runSweep({ dryRun: false });

    expect(result).toEqual({ skipped: true });
    expect(BlogContent.find).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('takes the lock with NX and a 10 minute expiry, and releases it only if it still owns it', async () => {
    await runSweep({ dryRun: false });

    const [key, token, options] = redisClient.set.mock.calls[0];
    expect(key).toBe('reconcile:lock');
    expect(typeof token).toBe('string');
    expect(options).toEqual({ NX: true, PX: 600000 });
    expect(redisClient.del).toHaveBeenCalledWith('reconcile:lock');
  });

  it("does not delete a lock that now belongs to someone else", async () => {
    redisClient.get.mockResolvedValue('another-run-token');

    await runSweep({ dryRun: false });

    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('releases the lock even when the sweep throws', async () => {
    BlogContent.find.mockImplementation(() => { throw new Error('mongo down'); });

    await expect(runSweep({ dryRun: false })).rejects.toThrow('mongo down');

    expect(redisClient.del).toHaveBeenCalledWith('reconcile:lock');
  });

  it('keeps going when one post fails to reconcile, and does not count it as fixed', async () => {
    givenPosts([post(A, 2, 1), post(B, 2, 1)]);
    postIndexer.reconcilePost.mockRejectedValueOnce(new Error('embed failed')).mockResolvedValueOnce({ action: 'indexed' });

    const result = await runSweep({ dryRun: false });

    expect(result).toEqual({ stale: 2, orphans: 0, fixed: 1 });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ postId: A }), expect.any(String));
  });

  it('does not count a post another worker already brought up to date', async () => {
    givenPosts([post(A, 2, 1)]);
    postIndexer.reconcilePost.mockResolvedValue({ action: 'skipped' });

    const result = await runSweep({ dryRun: false });

    expect(result).toEqual({ stale: 1, orphans: 0, fixed: 0 });
  });

  it('logs the result', async () => {
    await runSweep({ dryRun: true });
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ stale: 0, orphans: 0, fixed: 0, dryRun: true }), expect.any(String));
  });
});
