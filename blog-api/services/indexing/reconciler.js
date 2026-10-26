const crypto = require('crypto');
const { isValidObjectId } = require('mongoose');
const BlogContent = require('../../model/BlogContent');
const redisClient = require('../redisClient');
const postIndexer = require('./postIndexer');
const { getVectorStore } = require('../vectorStore');
const logger = require('../../src/utils/logger');

const LOCK_KEY = 'reconcile:lock';
const LOCK_TTL_MS = 600000;

// Compares Mongo (the source of truth) with the vector store and repairs drift:
//   stale pass  - posts whose indexedRevision is behind revision (or was never set) are re-indexed
//   orphan pass - vectors whose post no longer exists are removed
// With dryRun it only counts. One sweep at a time across all processes, via a Redis lock.
async function runSweep({ dryRun = true } = {}) {
    const token = crypto.randomUUID();
    const acquired = await redisClient.set(LOCK_KEY, token, { NX: true, PX: LOCK_TTL_MS });
    if (acquired !== 'OK') {
        return { skipped: true };
    }

    try {
        let stale = 0;
        let orphans = 0;
        let fixed = 0;

        const posts = BlogContent.find({}, { _id: 1, revision: 1, indexedRevision: 1 }).lean().cursor();
        for await (const post of posts) {
            const isStale = typeof post.indexedRevision !== 'number' || post.indexedRevision < (post.revision ?? 0);
            if (!isStale) continue;
            stale++;
            if (dryRun) continue;

            const postId = post._id.toString();
            try {
                const { action } = await postIndexer.reconcilePost(postId);
                if (action !== 'skipped') fixed++;
            } catch (err) {
                logger.warn({ err, postId }, 'Reconcile failed for post');
            }
        }

        for await (const postId of getVectorStore().listPostIds()) {
            const exists = isValidObjectId(postId) && await BlogContent.exists({ _id: postId });
            if (exists) continue;
            orphans++;
            if (dryRun) continue;

            try {
                await postIndexer.removePost(postId);
                fixed++;
            } catch (err) {
                logger.warn({ err, postId }, 'Removing orphaned vectors failed');
            }
        }

        const result = { stale, orphans, fixed };
        logger.info({ ...result, dryRun }, 'Reconciliation sweep finished');
        return result;
    } finally {
        // A race between GET and DEL is acceptable: the lock expires on its own after 10 minutes.
        try {
            if (await redisClient.get(LOCK_KEY) === token) {
                await redisClient.del(LOCK_KEY);
            }
        } catch (err) {
            logger.warn({ err }, 'Could not release the reconcile lock');
        }
    }
}

module.exports = { runSweep };
