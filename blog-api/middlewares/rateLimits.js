const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../src/config');
const redisClient = require('../services/redisClient');

const passthrough = (req, res, next) => next();

// Each limiter gets its own Redis key prefix so two limiters never share one counter per IP.
function createLimiter({ windowMs, limit, prefix }) {
  if (!config.rateLimitEnabled) return passthrough;

  const options = {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' }
  };
  if (config.nodeEnv !== 'test') {
    options.store = new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix
    });
  }
  return rateLimit(options);
}

// 10 attempts per 15 minutes per IP on login and register.
const authLimiter = createLimiter({ windowMs: 15 * 60 * 1000, limit: 10, prefix: 'rl:auth:' });
// 30 per minute per IP on the routes that fan out to the LLM / embedding / vector store.
const llmLimiter = createLimiter({ windowMs: 60 * 1000, limit: 30, prefix: 'rl:llm:' });

module.exports = { authLimiter, llmLimiter };
