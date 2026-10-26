const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.jwtSecret',
      'password',
      'token'
    ],
    censor: '[REDACTED]'
  },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

module.exports = logger;
