const { Queue } = require('bullmq');
const { bullConnection } = require('../src/config/redisConnection');

// attempts: 1 so status polling never reports a retrying job as failed.
const summarizeQueue = new Queue('summarize', {
    connection: bullConnection(),
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 }
    }
});

module.exports = summarizeQueue;
