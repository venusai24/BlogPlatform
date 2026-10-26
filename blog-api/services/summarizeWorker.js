const { Worker } = require('bullmq');
const summarizeService = require('./summarize');
const alertService = require('./alertService');
const config = require('../src/config');
const logger = require('../src/utils/logger');
const { bullConnection } = require('../src/config/redisConnection');

// Never log the connection object: it now carries the Redis password.
logger.info({ concurrency: config.summarizeConcurrency }, 'Initializing summarizeWorker');
const worker = new Worker('summarize', async job => {
    logger.debug({ jobId: job.id }, 'Processing summarize job');
    const { text, model } = job.data;
    try {
        const result = await summarizeService.summarizeJob({ text, model });
        logger.debug({ jobId: job.id }, 'Summarize job processed');
        return result;
    } catch (error) {
        logger.error({ err: error, jobId: job.id }, 'Error processing summarize job');
        throw error;
    }
}, { connection: bullConnection(), concurrency: config.summarizeConcurrency });

worker.on('completed', job => {
    logger.debug({ jobId: job.id }, 'Summarize job completed');
});
worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Summarize job failed');
    alertService.handleJobFailure('summarize', job, err);
});

module.exports = worker;
