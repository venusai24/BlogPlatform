const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { nodeRedisOptions } = require('./src/config/redisConnection');

let io;
let adapterReady = false;

module.exports = {
  init: (httpServer) => {
    io = socketIo(httpServer, {
      cors: {
        origin: config.corsAllowedOrigins,
        methods: ["GET", "POST", "PUT", "DELETE"]
      }
    });

    const pubClient = createClient(nodeRedisOptions());
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      adapterReady = true;
      logger.info('Socket.io Redis adapter attached successfully');
    }).catch(err => {
      logger.error({ err }, 'Failed to initialize Socket.io Redis adapter');
    });

    return io;
  },
  // Readiness does not depend on this; /ready only reports it.
  isAdapterReady: () => adapterReady,
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  }
};
