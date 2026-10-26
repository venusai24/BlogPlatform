// Lambda entry point for the indexing consumer (indexing_consumer_runtime = "lambda"): an SQS event
// source mapping delivers batches of domain events and this reconciles each post.
//
// Only @aws-sdk/client-ssm is required at load time. src/config exits the process when a required
// environment variable is missing, and three of them (MongoDB URI, JWT secret, Qdrant key) are
// secrets that Lambda environment variables would show in plain text, so they are read from SSM
// first and everything else is required afterwards.
const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');

const SECRETS = {
  mongodb_uri: 'MONGODB_URI',
  jwt_secret: 'JWT_SECRET',
  qdrant_api_key: 'QDRANT_API_KEY'
};

let initPromise;
let consumer;
let logger;

async function init() {
  const prefix = `/blogplatform/${process.env.APP_ENV}`;
  const ssm = new SSMClient({ region: process.env.AWS_REGION });
  const response = await ssm.send(new GetParametersCommand({
    Names: Object.keys(SECRETS).map(name => `${prefix}/${name}`),
    WithDecryption: true
  }));

  const found = new Set();
  for (const parameter of response.Parameters || []) {
    const name = parameter.Name.split('/').pop();
    if (SECRETS[name]) {
      process.env[SECRETS[name]] = parameter.Value;
      found.add(name);
    }
  }
  const missing = Object.keys(SECRETS).filter(name => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing SSM parameters under ${prefix}: ${missing.join(', ')}`);
  }

  // Now that the secrets are in the environment it is safe to load config.
  require('../config');
  logger = require('../utils/logger');
  const connectDB = require('../../config/dbConn');
  await connectDB(); // the mongoose pool is reused across warm invocations
  consumer = require('../../services/consumers/indexingConsumer');
}

exports.handler = async (event) => {
  // A failed initialisation is not cached, so the next invocation tries again.
  initPromise ??= init().catch((err) => {
    initPromise = undefined;
    throw err;
  });
  await initPromise;

  const mode = process.env.INDEXING_CONSUMER_MODE || 'active';
  const batchItemFailures = [];

  // Sequential: the pool is small (MONGO_MAX_POOL_SIZE=2) and the event source mapping already
  // limits how many invocations run at once.
  for (const record of event.Records) {
    try {
      await consumer.handle({ Body: record.body, MessageId: record.messageId }, mode);
    } catch (err) {
      logger.warn({ err, messageId: record.messageId }, 'record failed');
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  // Failed records go back to the queue and, after maxReceiveCount, to the DLQ.
  return { batchItemFailures };
};
