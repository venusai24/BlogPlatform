function loadConfig(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    let config;
    jest.isolateModules(() => {
      config = require('../index');
    });
    return config;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('reconcile config', () => {
  it('is off and a dry run by default', () => {
    const config = loadConfig();
    expect(config.reconcileIntervalMs).toBe(0);
    expect(config.reconcileDryRun).toBe(true);
  });

  it('reads the interval and RECONCILE_DRY_RUN=false', () => {
    const config = loadConfig({ RECONCILE_INTERVAL_MS: '3600000', RECONCILE_DRY_RUN: 'false' });
    expect(config.reconcileIntervalMs).toBe(3600000);
    expect(config.reconcileDryRun).toBe(false);
  });

  it('treats anything other than "false" as a dry run', () => {
    expect(loadConfig({ RECONCILE_DRY_RUN: 'no' }).reconcileDryRun).toBe(true);
  });
});
