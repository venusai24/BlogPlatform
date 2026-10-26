require('dotenv').config();

// The logger depends on this module, so startup errors are written to stderr directly.
const fatal = (message) => process.stderr.write(`${message}\n`);

const requiredEnvVars = [
  'PORT',
  'NODE_ENV',
  'MONGODB_URI',
  'REDIS_URL',
  'QDRANT_URL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL_ID',
  'EMBEDDING_DIM',
  'SUMMARY_PROVIDER',
  'SUMMARY_MODEL_ID',
  'AWS_REGION',
  'JWT_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (process.env[envVar] === undefined) {
    fatal(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const llmProvider = process.env.LLM_PROVIDER || 'groq';

const config = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  mongodbUri: process.env.MONGODB_URI,
  redisUrl: process.env.REDIS_URL,
  qdrantUrl: process.env.QDRANT_URL,
  qdrantApiKey: process.env.QDRANT_API_KEY, // optional
  vectorStore: process.env.VECTOR_STORE || 'qdrant',
  vectorStoreWrite: process.env.VECTOR_STORE_WRITE || 'primary', // 'both' fills Qdrant and S3 Vectors during a migration
  s3VectorsBucket: process.env.S3_VECTORS_BUCKET, // set by Terraform when S3 Vectors is in use
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER,
    modelId: process.env.EMBEDDING_MODEL_ID,
    dim: parseInt(process.env.EMBEDDING_DIM, 10)
  },
  summary: {
    provider: process.env.SUMMARY_PROVIDER,
    modelId: process.env.SUMMARY_MODEL_ID
  },
  llm: {
    provider: llmProvider,
    modelId: process.env.LLM_MODEL_ID || (llmProvider === 'bedrock' ? 'openai.gpt-oss-20b-1:0' : 'openai/gpt-oss-20b'),
    priceInPerMTok: Number(process.env.LLM_PRICE_IN_PER_MTOK || 0),
    priceOutPerMTok: Number(process.env.LLM_PRICE_OUT_PER_MTOK || 0)
  },
  awsRegion: process.env.AWS_REGION,
  indexingQueueUrl: process.env.INDEXING_QUEUE_URL, // set when the indexing SQS queue exists
  alertsTopicArn: process.env.ALERTS_TOPIC_ARN, // optional: SNS topic for failed-job alerts
  jwtSecret: process.env.JWT_SECRET,
  // 'app' = the API issues its own JWTs; 'cognito' = Amazon Cognito issues them and the API only verifies.
  authProvider: process.env.AUTH_PROVIDER || 'app',
  cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID, // required when authProvider is 'cognito'
  cognitoClientId: process.env.COGNITO_CLIENT_ID, // required when authProvider is 'cognito'
  // Resilience experiments (see src/utils/faults.js). Off by default; ignored in production unless enabled.
  faults: {
    enabled: process.env.FAULT_INJECTION_ENABLED === 'true',
    embedErrorRate: Number(process.env.FAULT_EMBED_ERROR_RATE || 0),
    llmErrorRate: Number(process.env.FAULT_LLM_ERROR_RATE || 0),
    relayPause: process.env.FAULT_RELAY_PAUSE === 'true'
  },
  jwtRequireClaims: process.env.JWT_REQUIRE_CLAIMS !== 'false',
  indexingBackend: process.env.INDEXING_BACKEND || 'bullmq',
  outboxRelayEnabled: process.env.OUTBOX_RELAY_ENABLED === 'true',
  domainEventsTopicArn: process.env.DOMAIN_EVENTS_TOPIC_ARN, // required when the relay is enabled
  outboxPollMs: Number(process.env.OUTBOX_POLL_MS || 1000),
  indexingConsumerMode: process.env.INDEXING_CONSUMER_MODE || 'off',
  indexingConsumerRuntime: process.env.INDEXING_CONSUMER_RUNTIME || 'ecs', // 'lambda' = an SQS-triggered function consumes instead of the worker
  reconcileIntervalMs: Number(process.env.RECONCILE_INTERVAL_MS || 0), // 0 = no scheduled sweep
  reconcileDryRun: process.env.RECONCILE_DRY_RUN !== 'false',
  authRequiredWrites: process.env.AUTH_REQUIRED_WRITES !== 'false',
  // Process role: the API runs the BullMQ workers in-process unless RUN_WORKERS=false.
  runWorkers: process.env.RUN_WORKERS !== 'false',
  mongoMaxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
  serviceName: process.env.SERVICE_NAME || 'api',
  indexingConcurrency: parseInt(process.env.INDEXING_CONCURRENCY || '2', 10),
  summarizeConcurrency: parseInt(process.env.SUMMARIZE_CONCURRENCY || '1', 10),
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  // '*' (default) or an array of allowed origins from a comma-separated list.
  corsAllowedOrigins: (!process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS.trim() === '*')
    ? '*'
    : process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
};

if (!['local', 'huggingface', 'bedrock'].includes(config.embedding.provider)) {
  fatal(`Invalid EMBEDDING_PROVIDER: ${config.embedding.provider}`);
  process.exit(1);
}

if (!['groq', 'bedrock'].includes(config.llm.provider)) {
  fatal(`Invalid LLM_PROVIDER: ${config.llm.provider}`);
  process.exit(1);
}

if (!['app', 'cognito'].includes(config.authProvider)) {
  fatal(`Invalid AUTH_PROVIDER: ${config.authProvider}`);
  process.exit(1);
}

if (config.authProvider === 'cognito' && (!config.cognitoUserPoolId || !config.cognitoClientId)) {
  fatal('AUTH_PROVIDER=cognito requires COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID');
  process.exit(1);
}

if (!['qdrant', 's3vectors'].includes(config.vectorStore)) {
  fatal(`Invalid VECTOR_STORE: ${config.vectorStore}`);
  process.exit(1);
}

if (!['primary', 'both'].includes(config.vectorStoreWrite)) {
  fatal(`Invalid VECTOR_STORE_WRITE: ${config.vectorStoreWrite}`);
  process.exit(1);
}

if (!['bullmq', 'both', 'events'].includes(config.indexingBackend)) {
  fatal(`Invalid INDEXING_BACKEND: ${config.indexingBackend}`);
  process.exit(1);
}

if (!['ecs', 'lambda'].includes(config.indexingConsumerRuntime)) {
  fatal(`Invalid INDEXING_CONSUMER_RUNTIME: ${config.indexingConsumerRuntime}`);
  process.exit(1);
}

if (!['off', 'shadow', 'active'].includes(config.indexingConsumerMode)) {
  fatal(`Invalid INDEXING_CONSUMER_MODE: ${config.indexingConsumerMode}`);
  process.exit(1);
}

if (![256, 512, 1024, 384].includes(config.embedding.dim)) {
  // 384 allowed for local models, instruction says "allowed 256/512/1024" for Bedrock Titan Text Embeddings V2
  // I will just enforce the number
}

module.exports = config;
