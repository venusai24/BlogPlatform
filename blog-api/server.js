const app = require('./app');
const http = require('http');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const port = config.port || 5000;
const server = http.createServer(app);
const mongoose = require('mongoose');
const redisClient = require('./services/redisClient'); // Assuming it's the client instance

// RUN_WORKERS=false runs the API only; the BullMQ workers then live in src/worker.js.
const workers = config.runWorkers
  ? [require('./services/summarizeWorker'), require('./services/indexingWorker')]
  : [];

const io = require('./socket').init(server);
io.on('connection', socket => {
  logger.info('Client connected');
});

if (require.main === module) {
  server.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
}

const shutdown = async (signal) => {
  logger.info(`${signal} received: shutting down`);

  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 25000).unref();

  // Stop taking jobs first so nothing is mid-flight when the databases close.
  await Promise.allSettled(workers.map(w => w.close()));
  logger.info('Workers closed');

  // io.close() also closes the underlying HTTP server, so server.close() is not called separately.
  await new Promise(resolve => io.close(() => resolve()));
  logger.info('Socket.io and HTTP server closed');

  try {
    await mongoose.connection.close(false);
    logger.info('MongoDB connection closed.');
  } catch (err) {
    logger.error({ err }, 'Error closing MongoDB connection');
  }

  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Redis connection closed.');
    }
  } catch (err) {
    logger.error({ err }, 'Error closing Redis connection');
  }

  process.exit(0);
};

if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { server, shutdown, workers };
