const { trace, ROOT_CONTEXT } = require('@opentelemetry/api');
const { setupTracing, TRACE_ID, TRACEPARENT } = require('../../../test/helpers/otel');
const { currentTraceparent, contextFromTraceparent } = require('../traceContext');

describe('traceContext', () => {
  let tracing;
  beforeAll(() => { tracing = setupTracing(); });
  afterAll(() => tracing.teardown());

  it('currentTraceparent returns a W3C traceparent inside an active span', () => {
    trace.getTracer('test').startActiveSpan('work', (span) => {
      const traceparent = currentTraceparent();

      expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
      expect(traceparent.split('-')[1]).toBe(span.spanContext().traceId);
      expect(traceparent.split('-')[2]).toBe(span.spanContext().spanId);
      span.end();
    });
  });

  it('currentTraceparent returns undefined outside any span', () => {
    expect(currentTraceparent()).toBeUndefined();
  });

  it('contextFromTraceparent round-trips the trace id', () => {
    const ctx = contextFromTraceparent(TRACEPARENT);
    const spanContext = trace.getSpanContext(ctx);

    expect(spanContext.traceId).toBe(TRACE_ID);
    expect(spanContext.isRemote).toBe(true);
  });

  it('a traceparent produced in a span can be turned back into the same trace', () => {
    trace.getTracer('test').startActiveSpan('producer', (span) => {
      const ctx = contextFromTraceparent(currentTraceparent());
      expect(trace.getSpanContext(ctx).traceId).toBe(span.spanContext().traceId);
      span.end();
    });
  });

  it.each([undefined, null, '', 'not-a-traceparent', '00-zzzz-zzzz-01'])('contextFromTraceparent(%p) is the root context', (value) => {
    const ctx = contextFromTraceparent(value);
    expect(trace.getSpanContext(ctx)).toBeUndefined();
    expect(ctx).toBe(ROOT_CONTEXT);
  });
});
