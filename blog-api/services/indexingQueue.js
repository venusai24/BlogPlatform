const { Queue } = require('bullmq');
const { bullConnection } = require('../src/config/redisConnection');

const indexingQueue = new Queue('indexing', {
    connection: bullConnection(),
    // Retry options are job options. BullMQ ignores them when passed to the Worker.
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000
        },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800 }
    }
});

module.exports = indexingQueue;
