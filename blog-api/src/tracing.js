// OpenTelemetry bootstrap, preloaded with `node -r ./src/tracing.js` so the instrumentations patch
// http, express, mongodb, ioredis and the AWS SDK before the app requires them.
// Off when OTEL_SDK_DISABLED=true (Terraform sets that unless enable_tracing is on, and the image
// defaults it to true). Spans go to a collector sidecar on localhost:4318, which forwards to X-Ray;
// without one the exporter only logs failures. Trace context is W3C, the default propagator.
if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { AWSXRayIdGenerator } = require('@opentelemetry/id-generator-aws-xray');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'blog-api',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    idGenerator: new AWSXRayIdGenerator(), // X-Ray rejects ids whose timestamp prefix is not recent
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })]
  });

  sdk.start();

  // Flush buffered spans on shutdown.
  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => {});
  });
}
