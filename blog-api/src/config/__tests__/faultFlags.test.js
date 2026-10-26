function loadConfig(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    let config;
    jest.isolateModules(() => { config = require('../index'); });
    return config;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

describe('fault injection config', () => {
  it('is off by default', () => {
    expect(loadConfig().faults).toEqual({ enabled: false, embedErrorRate: 0, llmErrorRate: 0, relayPause: false });
  });

  it('reads the environment', () => {
    const { faults } = loadConfig({
      FAULT_INJECTION_ENABLED: 'true',
      FAULT_EMBED_ERROR_RATE: '0.5',
      FAULT_LLM_ERROR_RATE: '0.25',
      FAULT_RELAY_PAUSE: 'true'
    });
    expect(faults).toEqual({ enabled: true, embedErrorRate: 0.5, llmErrorRate: 0.25, relayPause: true });
  });
});
