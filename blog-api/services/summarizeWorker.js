const { Worker } = require('bullmq');
const summarizeService = require('./summarize');
const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD
};

console.log("Initializing summarizeWorker with connection:", connection);
const worker = new Worker('summarize', async job => {
    console.log(`Processing job ${job.id} with data:`, job.data);
    const { text, model } = job.data;
    try {
        const result = await summarizeService.summarizeJob({ text, model });
        console.log(`Job ${job.id} processed successfully with result:`, result);
        return result;
    } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        throw error;
    }
}, { connection });

worker.on('completed', job => {
    console.log(`Job ${job.id} completed.`);
});
worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err);
});

module.exports = worker;
