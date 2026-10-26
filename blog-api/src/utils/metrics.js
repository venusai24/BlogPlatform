const config = require('../config');
const logger = require('./logger');

// Emits one CloudWatch Embedded Metric Format (EMF) record through the structured logger.
// On ECS with the awslogs driver, CloudWatch Logs turns the record into a custom metric
// (namespace BlogPlatform, dimension Service) with no agent or PutMetricData call.
function emitMetric(name, value, unit = 'Count') {
  logger.info({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: 'BlogPlatform',
        Dimensions: [['Service']],
        Metrics: [{ Name: name, Unit: unit }]
      }]
    },
    Service: config.serviceName,
    [name]: value
  }, 'metric');
}

module.exports = { emitMetric };
