const { propagation, context, ROOT_CONTEXT } = require('@opentelemetry/api');

// The W3C traceparent of the active span, or undefined when there is none (tracing off, or no request
// in flight). Stored in the outbox record so the async consumer can continue the originating trace.
function currentTraceparent() {
  const carrier = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

// The OpenTelemetry context for a stored traceparent. Missing or malformed values give the root
// context, which starts a new trace.
function contextFromTraceparent(traceparent) {
  return traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT;
}

module.exports = { currentTraceparent, contextFromTraceparent };
