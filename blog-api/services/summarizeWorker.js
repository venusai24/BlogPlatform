const { Worker } = require('bullmq');
const summarizeService = require('./summarize');
const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD
};

// Worker to process summarization jobs
const worker = new Worker('summarize', async job => {
    const { text, model } = job.data;
    return await summarizeService.summarizeJob({ text, model });
}, { connection });

worker.on('completed', job => {
    console.log(`Job ${job.id} completed.`);
});
worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err);
});

module.exports = worker;
