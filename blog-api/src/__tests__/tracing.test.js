const mockStart = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue();
const mockNodeSDK = jest.fn(() => ({ start: mockStart, shutdown: mockShutdown }));
const mockExporter = jest.fn();
const mockXRayIdGenerator = jest.fn();
const mockAutoInstrumentations = jest.fn(() => ['auto']);

jest.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: function (...args) { return mockNodeSDK(...args); } }));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: function (...args) { return mockExporter(...args); } }));
jest.mock('@opentelemetry/id-generator-aws-xray', () => ({ AWSXRayIdGenerator: function (...args) { return mockXRayIdGenerator(...args); } }));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({ getNodeAutoInstrumentations: (...args) => mockAutoInstrumentations(...args) }));

function load(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    jest.isolateModules(() => { require('../tracing'); });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

describe('src/tracing.js', () => {
  let onSpy;
  beforeEach(() => {
    jest.clearAllMocks();
    onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
  });
  afterEach(() => onSpy.mockRestore());

  it('does nothing when OTEL_SDK_DISABLED=true', () => {
    load({ OTEL_SDK_DISABLED: 'true' });

    expect(mockNodeSDK).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('starts the SDK otherwise, with X-Ray ids, an OTLP exporter and the service name', () => {
    load({ OTEL_SDK_DISABLED: 'false', OTEL_SERVICE_NAME: 'worker', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' });

    expect(mockExporter).toHaveBeenCalledWith({ url: 'http://localhost:4318/v1/traces' });
    expect(mockNodeSDK).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: 'worker',
      traceExporter: expect.anything(),
      idGenerator: expect.anything(),
      instrumentations: [['auto']]
    }));
    expect(mockAutoInstrumentations).toHaveBeenCalledWith({ '@opentelemetry/instrumentation-fs': { enabled: false } });
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('defaults the service name and the collector endpoint', () => {
    load({ OTEL_SDK_DISABLED: 'false', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined });

    expect(mockNodeSDK).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'blog-api' }));
    expect(mockExporter).toHaveBeenCalledWith({ url: 'http://localhost:4318/v1/traces' });
  });

  it('shuts the SDK down on SIGTERM', () => {
    load({ OTEL_SDK_DISABLED: 'false' });

    const sigterm = onSpy.mock.calls.find(([event]) => event === 'SIGTERM');
    expect(sigterm).toBeDefined();
    sigterm[1]();
    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });
});
