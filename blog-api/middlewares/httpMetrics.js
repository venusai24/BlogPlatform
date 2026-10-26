const { emitMetric } = require('../src/utils/metrics');

// Request count, 5xx count and latency, recorded when the response has been sent.
function httpMetrics(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        emitMetric('HttpRequests', 1);
        if (res.statusCode >= 500) emitMetric('Http5xx', 1);
        emitMetric('HttpLatencyMs', elapsedMs, 'Milliseconds');
    });
    next();
}

module.exports = httpMetrics;
