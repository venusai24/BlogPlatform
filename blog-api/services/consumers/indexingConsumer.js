const { trace, SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const postIndexer = require('../indexing/postIndexer');
const { EVENT_TYPES } = require('../events/domainEvents');
const logger = require('../../src/utils/logger');
const { emitMetric } = require('../../src/utils/metrics');
const { contextFromTraceparent } = require('../../src/utils/traceContext');

const tracer = trace.getTracer('blog-api');

// Thrown for a message that can never succeed (bad JSON, unknown type, bad post id). The poller leaves
// it on the queue, so it is retried and then moved to the DLQ for a human to look at.
class PoisonMessageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PoisonMessageError';
    }
}

const KNOWN_TYPES = Object.values(EVENT_TYPES);
const POST_ID = /^[0-9a-f]{24}$/;

function parse(message) {
    let envelope;
    try {
        envelope = JSON.parse(message.Body); // SNS raw delivery: the body is the envelope itself
    } catch (err) {
        throw new PoisonMessageError(`Malformed message body: ${err.message}`);
    }
    if (!envelope || !KNOWN_TYPES.includes(envelope.type)) {
        throw new PoisonMessageError(`Unknown event type: ${envelope && envelope.type}`);
    }
    const postId = envelope.data && envelope.data.postId;
    if (typeof postId !== 'string' || !POST_ID.test(postId)) {
        throw new PoisonMessageError('Event has no valid postId');
    }
    return { eventId: envelope.id, type: envelope.type, postId };
}

// Reads the envelope only to find the trace to continue and a few span attributes. parse() below does
// the real validation, so a bad body still gets a (failed) span but never blocks anything here.
function peek(message) {
    try {
        const envelope = JSON.parse(message.Body);
        return envelope && typeof envelope === 'object' ? envelope : {};
    } catch (err) {
        return {};
    }
}

// mode 'shadow': log what would happen. mode 'active': reconcile the post against Mongo.
// Reconcile is idempotent and re-reads the post, so duplicate or out-of-order events are harmless.
// The work runs in a consumer span that continues the trace of the request that wrote the post.
async function handle(message, mode) {
    const envelope = peek(message);
    const attributes = {
        'messaging.system': 'aws_sqs',
        'messaging.message.id': message.MessageId
    };
    if (envelope.id) attributes['cloudevents.event_id'] = envelope.id;
    const writtenAt = Date.parse(envelope.time);
    if (!Number.isNaN(writtenAt)) attributes['blog.outbox_to_consume_ms'] = Date.now() - writtenAt;

    return tracer.startActiveSpan(
        'indexing.consume',
        { kind: SpanKind.CONSUMER, attributes },
        contextFromTraceparent(envelope.traceparent),
        async (span) => {
            try {
                const { eventId, type, postId } = parse(message);

                if (mode === 'shadow') {
                    logger.info({ eventId, type, postId }, 'shadow: would reconcile post');
                    return;
                }
                if (mode === 'active') {
                    const { action } = await postIndexer.reconcilePost(postId);
                    logger.info({ eventId, type, postId, action }, 'reconciled post from event');
                    emitMetric('IndexingSucceeded', 1);
                    return;
                }
                throw new Error(`Unsupported INDEXING_CONSUMER_MODE: ${mode}`);
            } catch (err) {
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                emitMetric('IndexingFailed', 1);
                throw err;
            } finally {
                span.end();
            }
        }
    );
}

module.exports = { handle, PoisonMessageError };
