// Worker-only entrypoint: runs the BullMQ workers (and, in later tasks, background loops)
// without the HTTP server. Start with `node src/worker.js`.
const logger = require('./utils/logger');

const state = { workers: [], loops: [] };

async function start() {
  const config = require('./config');
  if (config.outboxRelayEnabled && !config.domainEventsTopicArn) {
    logger.error('OUTBOX_RELAY_ENABLED=true requires DOMAIN_EVENTS_TOPIC_ARN');
    process.exit(1);
    return state; // only reachable when process.exit is stubbed
  }
  // Only one runtime consumes the queue: with the Lambda runtime the worker leaves it alone.
  const workerConsumes = config.indexingConsumerMode !== 'off' && config.indexingConsumerRuntime === 'ecs';
  if (workerConsumes && !config.indexingQueueUrl) {
    logger.error('INDEXING_CONSUMER_MODE requires INDEXING_QUEUE_URL');
    process.exit(1);
    return state; // only reachable when process.exit is stubbed
  }
  const connectDB = require('../config/dbConn');
  await connectDB();

  state.workers.push(
    require('../services/summarizeWorker'),
    require('../services/indexingWorker')
  );
  if (config.outboxRelayEnabled) {
    const outboxRelay = require('../services/events/outboxRelay');
    outboxRelay.start();
    state.loops.push({ stop: outboxRelay.stop });
  }
  if (workerConsumes) {
    const { SqsPoller } = require('../services/consumers/sqsPoller');
    const { handle } = require('../services/consumers/indexingConsumer');
    const mode = config.indexingConsumerMode;
    const poller = new SqsPoller({
      queueUrl: config.indexingQueueUrl,
      handler: message => handle(message, mode)
    });
    poller.start();
    state.loops.push({ stop: () => poller.stop() });
  }
  if (config.reconcileIntervalMs > 0) {
    const { runSweep } = require('../services/indexing/reconciler');
    let inFlight = null;
    const timer = setInterval(() => {
      inFlight = runSweep({ dryRun: config.reconcileDryRun })
        .catch(err => logger.error({ err }, 'Reconciliation sweep failed'))
        .finally(() => { inFlight = null; });
    }, config.reconcileIntervalMs);
    timer.unref();
    state.loops.push({
      stop: async () => {
        clearInterval(timer);
        if (inFlight) await inFlight;
      }
    });
  }
  logger.info({ workers: state.workers.length, loops: state.loops.length }, 'Worker process started');
  return state;
}

async function stop() {
  const mongoose = require('mongoose');
  const redisClient = require('../services/redisClient');

  await Promise.allSettled(state.loops.map(loop => loop.stop()));
  await Promise.allSettled(state.workers.map(w => w.close()));
  state.loops = [];
  state.workers = [];
  logger.info('Workers closed');

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
}

module.exports = { start, stop, state };

if (require.main === module) {
  const shutdown = () => stop().then(() => process.exit(0));
  start().catch(err => {
    logger.error({ err }, 'Worker failed to start');
    process.exit(1);
  });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
