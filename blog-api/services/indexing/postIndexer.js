const BlogContent = require('../../model/BlogContent');
const { embed } = require('../embeddingService');
const { getWriteStores } = require('../vectorStore');
const { chunkText } = require('../../utils/chunkText');

const { COLLECTIONS, MAX_CONTENT_CHUNKS, titleId, chunkId, summaryId } = require('./pointIds');

// Each write goes to every write store (two during a store migration) before the next write starts,
// so "upsert before prune" holds in all of them.
async function writeAll(method, ...args) {
    for (const store of getWriteStores()) {
        await store[method](...args);
    }
}

// Brings the vector store in line with one post. Writes before it deletes, so a failure part-way
// leaves the old vectors searchable rather than none.
async function indexPost(blog) {
    const id = blog._id.toString();
    const revision = blog.revision ?? 0;

    const chunks = chunkText(blog.content);
    if (chunks.length > MAX_CONTENT_CHUNKS) {
        throw new Error('content too long to index');
    }
    const chunkCount = chunks.length;
    const previousCount = typeof blog.indexedChunkCount === 'number' ? blog.indexedChunkCount : null;

    // Never indexed by this code: clear whatever an older indexer left behind.
    if (previousCount === null) {
        await writeAll('deleteByPost', COLLECTIONS.content, id);
    }

    const titleEmbeddings = await embed([blog.title]);
    if (titleEmbeddings.length > 0) {
        await writeAll('upsert', COLLECTIONS.title, [{
            id: titleId(id),
            vector: titleEmbeddings[0],
            payload: { blogId: id, title: blog.title, snippet: blog.content.substring(0, 200), author: blog.author }
        }]);
    }

    if (chunkCount > 0) {
        const contentEmbeddings = await embed(chunks);
        await writeAll('upsert', COLLECTIONS.content, chunks.map((chunk, index) => ({
            id: chunkId(id, index),
            vector: contentEmbeddings[index],
            payload: { blogId: id, title: blog.title, snippet: chunk, author: blog.author, chunkIndex: index }
        })));
    }

    const summaryText = blog.summary || '';
    if (summaryText.trim()) {
        const summaryEmbeddings = await embed([summaryText]);
        if (summaryEmbeddings.length > 0) {
            await writeAll('upsert', COLLECTIONS.summary, [{
                id: summaryId(id),
                vector: summaryEmbeddings[0],
                payload: { blogId: id, title: blog.title, snippet: summaryText, author: blog.author }
            }]);
        }
    } else {
        await writeAll('deleteByIds', COLLECTIONS.summary, [summaryId(id)]);
    }

    if (previousCount !== null && previousCount > chunkCount) {
        const stale = [];
        for (let i = chunkCount; i < previousCount; i++) stale.push(chunkId(id, i));
        await writeAll('deleteByIds', COLLECTIONS.content, stale);
    }

    // Only record progress if the post has not been edited since this revision was read.
    await BlogContent.updateOne(
        { _id: blog._id, $or: [{ revision }, { revision: { $exists: false } }] },
        { $set: { indexedChunkCount: chunkCount, indexedRevision: revision, indexedAt: new Date() } }
    );
}

async function removePost(postId) {
    for (const collection of Object.values(COLLECTIONS)) {
        await writeAll('deleteByPost', collection, postId);
    }
}

// Idempotent: safe to call for any post at any time, from a queue job or a sweep.
async function reconcilePost(postId) {
    const blog = await BlogContent.findById(postId);
    if (!blog) {
        await removePost(postId);
        return { action: 'removed' };
    }
    if (typeof blog.indexedRevision === 'number' && blog.indexedRevision >= (blog.revision ?? 0)) {
        return { action: 'skipped' };
    }
    await indexPost(blog);
    return { action: 'indexed' };
}

module.exports = { indexPost, removePost, reconcilePost, MAX_CONTENT_CHUNKS, COLLECTIONS, titleId, chunkId, summaryId };
