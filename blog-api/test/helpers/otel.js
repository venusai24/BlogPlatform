// Registers an in-memory OpenTelemetry setup for tests: W3C propagation, an async-local context
// manager (so startActiveSpan really makes a span active across awaits) and an exporter to read spans from.
// @opentelemetry/core and @opentelemetry/context-async-hooks are not direct dependencies; they are
// pinned by @opentelemetry/sdk-node, which is.
const { trace, propagation, context } = require('@opentelemetry/api');
const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');

function setupTracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const contextManager = new AsyncLocalStorageContextManager().enable();

  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  context.setGlobalContextManager(contextManager);

  return {
    exporter,
    finishedSpans: name => exporter.getFinishedSpans().filter(span => !name || span.name === name),
    reset: () => exporter.reset(),
    teardown: async () => {
      trace.disable();
      propagation.disable();
      context.disable();
      contextManager.disable();
      await provider.shutdown();
    }
  };
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

module.exports = { setupTracing, TRACE_ID, SPAN_ID, TRACEPARENT };
