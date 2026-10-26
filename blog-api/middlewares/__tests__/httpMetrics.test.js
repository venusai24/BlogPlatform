const { EventEmitter } = require('events');

jest.mock('../../src/utils/metrics', () => ({ emitMetric: jest.fn() }));

const { emitMetric } = require('../../src/utils/metrics');
const httpMetrics = require('../httpMetrics');

function finish(statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  const next = jest.fn();
  httpMetrics({}, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  res.emit('finish');
}

describe('httpMetrics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits nothing until the response finishes', () => {
    httpMetrics({}, new EventEmitter(), jest.fn());
    expect(emitMetric).not.toHaveBeenCalled();
  });

  it('emits request count and latency for a 200', () => {
    finish(200);

    expect(emitMetric).toHaveBeenCalledWith('HttpRequests', 1);
    expect(emitMetric).toHaveBeenCalledWith('HttpLatencyMs', expect.any(Number), 'Milliseconds');
    expect(emitMetric).not.toHaveBeenCalledWith('Http5xx', expect.anything());
  });

  it('also emits Http5xx for a server error', () => {
    finish(503);
    expect(emitMetric).toHaveBeenCalledWith('Http5xx', 1);
  });

  it('does not count a 4xx as a server error', () => {
    finish(404);
    expect(emitMetric).not.toHaveBeenCalledWith('Http5xx', expect.anything());
  });
});
