const mongoose = require('mongoose');
const BlogContent = require('../model/BlogContent');
const indexingQueue = require('./indexingQueue');
const { appendEvent } = require('./events/outbox');
const { EVENT_TYPES } = require('./events/domainEvents');
const config = require('../src/config');
const logger = require('../src/utils/logger');
const { currentTraceparent } = require('../src/utils/traceContext');

// INDEXING_BACKEND: 'bullmq' (enqueue only), 'events' (outbox only), 'both'.
const backend = () => {
  const mode = config.indexingBackend;
  return { useEvents: mode !== 'bullmq', useBull: mode !== 'events' };
};

// Runs `work(session)` in a Mongo transaction when `useEvents`, otherwise `work()` with no session.
async function inTransaction(useEvents, work) {
  if (!useEvents) return work();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await work(session);
    });
  } finally {
    await session.endSession();
  }
}

async function enqueue(name, blogId) {
  try {
    await indexingQueue.add(name, { blogId });
  } catch (err) {
    logger.error({ err, blogId }, 'Failed to enqueue indexing job');
  }
}

async function createPost(data) {
  const { useEvents, useBull } = backend();
  const blog = new BlogContent({ ...data, revision: 1 });
  const blogId = blog._id.toString();

  await inTransaction(useEvents, async (session) => {
    if (session) {
      await blog.save({ session });
      await appendEvent(session, { type: EVENT_TYPES.CREATED, postId: blogId, revision: 1, traceparent: currentTraceparent() });
    } else {
      await blog.save();
    }
  });

  if (useBull) await enqueue('index-blog', blogId);
  return blog;
}

async function updatePost(blog, changes) {
  const { useEvents, useBull } = backend();
  Object.assign(blog, changes);
  blog.revision = (blog.revision || 0) + 1;
  const blogId = blog._id.toString();

  await inTransaction(useEvents, async (session) => {
    if (session) {
      await blog.save({ session });
      await appendEvent(session, { type: EVENT_TYPES.UPDATED, postId: blogId, revision: blog.revision, traceparent: currentTraceparent() });
    } else {
      await blog.save();
    }
  });

  if (useBull) await enqueue('index-blog', blogId);
  return blog;
}

async function deletePost(blog) {
  const { useEvents, useBull } = backend();
  const revision = (blog.revision || 0) + 1;
  const blogId = blog._id.toString();

  await inTransaction(useEvents, async (session) => {
    if (session) {
      await BlogContent.deleteOne({ _id: blog._id }, { session });
      await appendEvent(session, { type: EVENT_TYPES.DELETED, postId: blogId, revision, traceparent: currentTraceparent() });
    } else {
      await BlogContent.deleteOne({ _id: blog._id });
    }
  });

  if (useBull) await enqueue('delete-blog-embeddings', blogId);
}

module.exports = { createPost, updatePost, deletePost };
