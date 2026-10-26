const { trace, SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const Outbox = require('../../model/Outbox');
const { publish } = require('./snsPublisher');
const config = require('../../src/config');
const logger = require('../../src/utils/logger');
const { emitMetric } = require('../../src/utils/metrics');
const { contextFromTraceparent } = require('../../src/utils/traceContext');
const { relayPaused } = require('../../src/utils/faults');

const tracer = trace.getTracer('blog-api');

const LEASE_MS = 30000;
const MAX_BACKOFF_MS = 300000;
const ERROR_LOG_AFTER_ATTEMPTS = 10;
const PENDING_GAUGE_INTERVAL_MS = 60000;

// Takes a 30s lease on the oldest due record so concurrent relays never publish the same row.
function claimNext(now) {
    return Outbox.findOneAndUpdate(
        {
            status: 'pending',
            nextAttemptAt: { $lte: now },
            $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }]
        },
        { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
        { sort: { _id: 1 }, new: true }
    );
}

// The publish span is a producer span in a trace of its own, linked (not parented) to the request
// that wrote the post: the relay runs some time after the request has finished.
function publishTraced(envelope) {
    const originating = envelope.traceparent ? trace.getSpanContext(contextFromTraceparent(envelope.traceparent)) : undefined;
    return tracer.startActiveSpan('outbox.publish', {
        kind: SpanKind.PRODUCER,
        links: originating ? [{ context: originating }] : [],
        attributes: {
            'messaging.system': 'aws_sns',
            'messaging.destination.name': 'domain-events',
            'cloudevents.event_id': envelope.id
        }
    }, async (span) => {
        try {
            await publish(envelope);
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            throw err;
        } finally {
            span.end();
        }
    });
}

// Delivery is at-least-once: a crash between publish and the status update republishes the record.
async function runOnce(now = new Date(), max = 10) {
    // Fault injection: a paused relay claims nothing, so the backlog builds up in the outbox.
    if (relayPaused()) return { published: 0, failed: 0, paused: true };

    let published = 0;
    let failed = 0;

    for (let i = 0; i < max; i++) {
        const doc = await claimNext(now);
        if (!doc) break;

        try {
            await publishTraced(doc.envelope);
            await Outbox.updateOne(
                { _id: doc._id },
                { $set: { status: 'published', publishedAt: now, lockedUntil: null, lastError: null } }
            );
            published++;
        } catch (err) {
            failed++;
            emitMetric('OutboxPublishFailed', 1);
            const retryAt = new Date(now.getTime() + Math.min(1000 * 2 ** doc.attempts, MAX_BACKOFF_MS));
            await Outbox.updateOne(
                { _id: doc._id },
                { $set: { lockedUntil: null, lastError: String(err.message).slice(0, 500), nextAttemptAt: retryAt } }
            );
            const log = doc.attempts >= ERROR_LOG_AFTER_ATTEMPTS ? logger.error : logger.warn;
            log.call(logger, { err, outboxId: String(doc._id), attempts: doc.attempts }, 'Outbox publish failed');
        }
    }
    return { published, failed };
}

let timer = null;
let gaugeTimer = null;
let inFlight = null;
let running = false;

// Backlog size, so an alarm can notice a relay that is down or stuck.
async function reportPending() {
    try {
        emitMetric('OutboxPending', await Outbox.countDocuments({ status: 'pending' }));
    } catch (err) {
        logger.warn({ err }, 'Could not count pending outbox records');
    }
}

function schedule(delayMs) {
    if (!running) return;
    timer = setTimeout(() => {
        timer = null;
        inFlight = runOnce()
            .catch(err => logger.error({ err }, 'Outbox relay tick failed'))
            .finally(() => {
                inFlight = null;
                schedule(config.outboxPollMs);
            });
    }, delayMs);
    timer.unref();
}

function start() {
    if (running) return;
    running = true;
    schedule(0);
    reportPending();
    gaugeTimer = setInterval(reportPending, PENDING_GAUGE_INTERVAL_MS);
    gaugeTimer.unref();
}

async function stop() {
    running = false;
    if (gaugeTimer) {
        clearInterval(gaugeTimer);
        gaugeTimer = null;
    }
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (inFlight) await inFlight;
}

module.exports = { claimNext, runOnce, start, stop };
