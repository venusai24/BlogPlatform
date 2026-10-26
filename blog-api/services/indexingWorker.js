const { Worker } = require('bullmq');
const postIndexer = require('./indexing/postIndexer');
const alertService = require('./alertService');

const config = require('../src/config');
const logger = require('../src/utils/logger');
const { bullConnection } = require('../src/config/redisConnection');

// Never log the connection object: it now carries the Redis password.
logger.info({ concurrency: config.indexingConcurrency }, 'Initializing indexingWorker');

// Retries (attempts/backoff) are configured on the queue's defaultJobOptions in indexingQueue.js.
const worker = new Worker('indexing', async job => {
    logger.debug({ jobId: job.id, jobName: job.name, blogId: job.data?.blogId }, 'Processing indexing job');

    if (job.name === 'index-blog') {
        const { blogId } = job.data;
        // A post that no longer exists has its vectors removed instead of failing the job.
        const { action } = await postIndexer.reconcilePost(blogId);
        logger.info({ blogId, action }, 'Reconciled blog');

    } else if (job.name === 'delete-blog-embeddings') {
        const { blogId } = job.data;
        await postIndexer.removePost(blogId);
        logger.info({ blogId }, 'Deleted embeddings for blog');

    } else {
        throw new Error(`[IndexingWorker] Unknown job name: ${job.name}`);
    }
}, { connection: bullConnection(), concurrency: config.indexingConcurrency });

worker.on('completed', job => {
    logger.debug({ jobId: job.id, jobName: job.name }, 'Indexing job completed');
});

worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, jobName: job?.name }, 'Indexing job failed');
    alertService.handleJobFailure('indexing', job, err);
});

module.exports = worker;
