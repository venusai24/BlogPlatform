describe('MonitoringLog schema', () => {
  it('expires rows after 30 days by default', () => {
    const { schema } = require('../MonitoringLog');
    expect(schema.indexes()).toContainEqual([
      { timestamp: 1 },
      expect.objectContaining({ expireAfterSeconds: 2592000 })
    ]);
  });

  it('honours MONITORING_LOG_TTL_DAYS', () => {
    process.env.MONITORING_LOG_TTL_DAYS = '7';
    try {
      let schema;
      jest.isolateModules(() => {
        ({ schema } = require('../MonitoringLog'));
      });
      expect(schema.indexes()).toContainEqual([
        { timestamp: 1 },
        expect.objectContaining({ expireAfterSeconds: 7 * 86400 })
      ]);
    } finally {
      delete process.env.MONITORING_LOG_TTL_DAYS;
    }
  });
});
