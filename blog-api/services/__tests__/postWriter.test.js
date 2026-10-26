const mockSave = jest.fn();
const mockAdd = jest.fn();

jest.mock('../../model/BlogContent', () => {
  const BlogContent = jest.fn().mockImplementation(doc => ({
    ...doc,
    _id: { toString: () => 'blog-id-1' },
    save: mockSave
  }));
  BlogContent.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
  return BlogContent;
});
jest.mock('../../model/Outbox', () => ({ create: jest.fn().mockResolvedValue([]) }));
jest.mock('../indexingQueue', () => ({ add: (...args) => mockAdd(...args) }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mongoose = require('mongoose');
const config = require('../../src/config');
const logger = require('../../src/utils/logger');
const BlogContent = require('../../model/BlogContent');
const Outbox = require('../../model/Outbox');
const { createPost, updatePost, deletePost } = require('../postWriter');

describe('postWriter', () => {
  const originalBackend = config.indexingBackend;
  let session;
  let startSession;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue();
    mockAdd.mockResolvedValue();
    session = { withTransaction: jest.fn(fn => fn()), endSession: jest.fn().mockResolvedValue() };
    startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });
  afterEach(() => {
    config.indexingBackend = originalBackend;
    startSession.mockRestore();
  });

  describe('createPost', () => {
    it('bullmq: saves without a transaction and enqueues', async () => {
      config.indexingBackend = 'bullmq';

      const blog = await createPost({ title: 'T', content: 'C', author: 'a' });

      expect(startSession).not.toHaveBeenCalled();
      expect(BlogContent).toHaveBeenCalledWith(expect.objectContaining({ title: 'T', revision: 1 }));
      expect(mockSave).toHaveBeenCalledWith();
      expect(Outbox.create).not.toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledWith('index-blog', { blogId: 'blog-id-1' });
      expect(blog.title).toBe('T');
    });

    it('events: writes the post and outbox in one transaction and does not enqueue', async () => {
      config.indexingBackend = 'events';

      await createPost({ title: 'T', content: 'C', author: 'a' });

      expect(startSession).toHaveBeenCalledTimes(1);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith({ session });
      expect(Outbox.create).toHaveBeenCalledWith(
        [expect.objectContaining({ eventType: 'blog.post.created', aggregateId: 'blog-id-1', revision: 1, status: 'pending' })],
        { session }
      );
      expect(session.endSession).toHaveBeenCalledTimes(1);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('both: does both', async () => {
      config.indexingBackend = 'both';

      await createPost({ title: 'T', content: 'C', author: 'a' });

      expect(mockSave).toHaveBeenCalledWith({ session });
      expect(Outbox.create).toHaveBeenCalledTimes(1);
      expect(mockAdd).toHaveBeenCalledWith('index-blog', { blogId: 'blog-id-1' });
    });

    it('enqueue failure is logged, not thrown', async () => {
      config.indexingBackend = 'bullmq';
      mockAdd.mockRejectedValue(new Error('redis down'));

      await expect(createPost({ title: 'T', content: 'C', author: 'a' })).resolves.toBeDefined();

      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ blogId: 'blog-id-1' }), 'Failed to enqueue indexing job');
    });

    it('ends the session and rethrows when the transaction fails', async () => {
      config.indexingBackend = 'events';
      session.withTransaction.mockRejectedValue(new Error('txn aborted'));

      await expect(createPost({ title: 'T', content: 'C', author: 'a' })).rejects.toThrow('txn aborted');

      expect(session.endSession).toHaveBeenCalledTimes(1);
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  describe('updatePost', () => {
    const existing = () => ({ _id: { toString: () => 'blog-id-1' }, title: 'old', revision: 2, save: mockSave });

    it('increments revision, applies changes and writes an updated event', async () => {
      config.indexingBackend = 'events';
      const blog = existing();

      const result = await updatePost(blog, { title: 'new' });

      expect(result.title).toBe('new');
      expect(blog.revision).toBe(3);
      expect(mockSave).toHaveBeenCalledWith({ session });
      expect(Outbox.create).toHaveBeenCalledWith(
        [expect.objectContaining({ eventType: 'blog.post.updated', revision: 3 })],
        { session }
      );
    });

    it('treats a missing revision as 0', async () => {
      config.indexingBackend = 'bullmq';
      const blog = { ...existing(), revision: undefined };

      await updatePost(blog, { title: 'new' });

      expect(blog.revision).toBe(1);
      expect(mockAdd).toHaveBeenCalledWith('index-blog', { blogId: 'blog-id-1' });
    });
  });

  describe('deletePost', () => {
    it('events: deletes in a transaction and writes a deleted event with revision+1', async () => {
      config.indexingBackend = 'events';
      const blog = { _id: 'oid-1', revision: 4 };

      await deletePost(blog);

      expect(BlogContent.deleteOne).toHaveBeenCalledWith({ _id: 'oid-1' }, { session });
      expect(Outbox.create).toHaveBeenCalledWith(
        [expect.objectContaining({ eventType: 'blog.post.deleted', aggregateId: 'oid-1', revision: 5 })],
        { session }
      );
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('bullmq: deletes without a transaction and enqueues the embedding delete', async () => {
      config.indexingBackend = 'bullmq';

      await deletePost({ _id: 'oid-1', revision: 4 });

      expect(startSession).not.toHaveBeenCalled();
      expect(BlogContent.deleteOne).toHaveBeenCalledWith({ _id: 'oid-1' });
      expect(mockAdd).toHaveBeenCalledWith('delete-blog-embeddings', { blogId: 'oid-1' });
    });

    it('a failed delete enqueue is logged, not thrown', async () => {
      config.indexingBackend = 'both';
      mockAdd.mockRejectedValue(new Error('redis down'));

      await expect(deletePost({ _id: 'oid-1', revision: 0 })).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
