const config = require('./index');

// node-redis v4 client options (redisClient.js, Socket.IO adapter).
function nodeRedisOptions() {
  return {
    url: config.redisUrl,
    password: process.env.REDIS_PASSWORD,
    socket: {
      tls: process.env.REDIS_TLS_ENABLED === 'true',
      ca: process.env.REDIS_TLS_CA_CERTS || undefined,
      key: process.env.REDIS_TLS_KEY || undefined,
      cert: process.env.REDIS_TLS_CERT || undefined
    }
  };
}

// ioredis options for BullMQ. Workers require maxRetriesPerRequest: null.
function bullConnection() {
  return {
    url: config.redisUrl,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS_ENABLED === 'true' ? {} : undefined,
    maxRetriesPerRequest: null
  };
}

module.exports = { nodeRedisOptions, bullConnection };
