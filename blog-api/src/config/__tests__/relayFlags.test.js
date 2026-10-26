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

describe('outbox relay config', () => {
  it('is off by default with a 1s poll', () => {
    const config = loadConfig();
    expect(config.outboxRelayEnabled).toBe(false);
    expect(config.domainEventsTopicArn).toBeUndefined();
    expect(config.outboxPollMs).toBe(1000);
  });

  it('reads the environment', () => {
    const config = loadConfig({
      OUTBOX_RELAY_ENABLED: 'true',
      DOMAIN_EVENTS_TOPIC_ARN: 'arn:aws:sns:ap-south-1:1:t',
      OUTBOX_POLL_MS: '250'
    });
    expect(config.outboxRelayEnabled).toBe(true);
    expect(config.domainEventsTopicArn).toBe('arn:aws:sns:ap-south-1:1:t');
    expect(config.outboxPollMs).toBe(250);
  });
});
