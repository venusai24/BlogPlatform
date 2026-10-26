jest.mock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const logger = require('../logger');
const { emitMetric } = require('../metrics');

describe('emitMetric', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs a CloudWatch Embedded Metric Format record', () => {
    const before = Date.now();

    emitMetric('X', 1);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [record, message] = logger.info.mock.calls[0];
    expect(message).toBe('metric');
    expect(record._aws.CloudWatchMetrics[0]).toEqual({
      Namespace: 'BlogPlatform',
      Dimensions: [['Service']],
      Metrics: [{ Name: 'X', Unit: 'Count' }]
    });
    expect(record._aws.Timestamp).toBeGreaterThanOrEqual(before);
    expect(record.X).toBe(1);
    expect(record.Service).toBe('api');
  });

  it('uses the given unit and value', () => {
    emitMetric('HttpLatencyMs', 42.5, 'Milliseconds');

    const [record] = logger.info.mock.calls[0];
    expect(record._aws.CloudWatchMetrics[0].Metrics[0]).toEqual({ Name: 'HttpLatencyMs', Unit: 'Milliseconds' });
    expect(record.HttpLatencyMs).toBe(42.5);
  });

  it('tags the metric with the configured service name', () => {
    let isolated;
    process.env.SERVICE_NAME = 'worker';
    try {
      jest.isolateModules(() => {
        jest.doMock('../logger', () => ({ info: jest.fn() }));
        isolated = { metrics: require('../metrics'), logger: require('../logger') };
      });
      isolated.metrics.emitMetric('OutboxPending', 3);
      expect(isolated.logger.info.mock.calls[0][0].Service).toBe('worker');
    } finally {
      delete process.env.SERVICE_NAME;
    }
  });
});
