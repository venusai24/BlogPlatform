const mockRunSweep = jest.fn();

jest.mock('../config/dbConn', () => jest.fn().mockResolvedValue());
jest.mock('../services/summarizeWorker', () => ({ close: jest.fn().mockResolvedValue() }));
jest.mock('../services/indexingWorker', () => ({ close: jest.fn().mockResolvedValue() }));
jest.mock('mongoose', () => ({ connection: { close: jest.fn().mockResolvedValue() } }));
jest.mock('../services/redisClient', () => ({ isOpen: false, quit: jest.fn() }));
jest.mock('../services/indexing/reconciler', () => ({ runSweep: (...args) => mockRunSweep(...args) }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe('worker.start with the reconciliation sweep', () => {
  const config = require('../src/config');
  const original = { interval: config.reconcileIntervalMs, dryRun: config.reconcileDryRun };
  let worker;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRunSweep.mockResolvedValue({ stale: 0, orphans: 0, fixed: 0 });
    jest.isolateModules(() => {
      worker = require('../src/worker');
    });
  });
  afterEach(() => {
    config.reconcileIntervalMs = original.interval;
    config.reconcileDryRun = original.dryRun;
    jest.useRealTimers();
  });

  it('does not schedule a sweep when the interval is 0', async () => {
    config.reconcileIntervalMs = 0;

    const state = await worker.start();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(mockRunSweep).not.toHaveBeenCalled();
    expect(state.loops).toHaveLength(0);
  });

  it('runs a sweep every interval with the configured dry-run flag, and stop() cancels it', async () => {
    config.reconcileIntervalMs = 60000;
    config.reconcileDryRun = false;

    const state = await worker.start();
    expect(state.loops).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(60000);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    expect(mockRunSweep).toHaveBeenCalledWith({ dryRun: false });

    await jest.advanceTimersByTimeAsync(60000);
    expect(mockRunSweep).toHaveBeenCalledTimes(2);

    await state.loops[0].stop();
    await jest.advanceTimersByTimeAsync(5 * 60000);
    expect(mockRunSweep).toHaveBeenCalledTimes(2);
  });

  it('a failing sweep does not stop later ones', async () => {
    config.reconcileIntervalMs = 1000;
    mockRunSweep.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ stale: 0, orphans: 0, fixed: 0 });

    await worker.start();
    await jest.advanceTimersByTimeAsync(2000);

    expect(mockRunSweep).toHaveBeenCalledTimes(2);
  });

  it('stop() waits for a sweep that is in flight', async () => {
    config.reconcileIntervalMs = 1000;
    let finish;
    mockRunSweep.mockImplementation(() => new Promise(resolve => { finish = () => resolve({}); }));

    const state = await worker.start();
    await jest.advanceTimersByTimeAsync(1000);

    let stopped = false;
    const stopping = state.loops[0].stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finish();
    await stopping;
    expect(stopped).toBe(true);
  });
});
