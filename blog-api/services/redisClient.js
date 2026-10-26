const Redis = require('redis');
const logger = require('../src/utils/logger');
const { nodeRedisOptions } = require('../src/config/redisConnection');

const client = Redis.createClient(nodeRedisOptions());

client.on('error', (err) => logger.error({ err }, 'Redis Client Error'));

(async () => {
    if (!client.isOpen) {
        await client.connect();
    }
})();

module.exports = client;
