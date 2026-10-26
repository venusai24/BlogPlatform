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

describe('INDEXING_CONSUMER_MODE', () => {
  it('defaults to off', () => {
    expect(loadConfig().indexingConsumerMode).toBe('off');
  });

  it.each(['off', 'shadow', 'active'])('accepts %s', (value) => {
    expect(loadConfig({ INDEXING_CONSUMER_MODE: value }).indexingConsumerMode).toBe(value);
  });

  it('exits 1 on an unknown value', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const error = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      loadConfig({ INDEXING_CONSUMER_MODE: 'sometimes' });
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});

describe('INDEXING_CONSUMER_RUNTIME', () => {
  it('defaults to ecs', () => {
    expect(loadConfig().indexingConsumerRuntime).toBe('ecs');
  });

  it.each(['ecs', 'lambda'])('accepts %s', (value) => {
    expect(loadConfig({ INDEXING_CONSUMER_RUNTIME: value }).indexingConsumerRuntime).toBe(value);
  });

  it('exits 1 on an unknown value', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      loadConfig({ INDEXING_CONSUMER_RUNTIME: 'fargate-spot' });
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      write.mockRestore();
    }
  });
});
