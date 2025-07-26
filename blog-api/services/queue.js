const { Queue } = require('bullmq');

const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD
};


const summarizeQueue = new Queue('summarize', { connection });


module.exports = summarizeQueue;
