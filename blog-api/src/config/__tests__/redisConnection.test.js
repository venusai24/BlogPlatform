function load(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    let mod;
    jest.isolateModules(() => {
      mod = require('../redisConnection');
    });
    return mod;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('redisConnection', () => {
  const originalTls = process.env.REDIS_TLS_ENABLED;
  const originalPassword = process.env.REDIS_PASSWORD;
  const originalCa = process.env.REDIS_TLS_CA_CERTS;
  afterEach(() => {
    for (const [k, v] of [['REDIS_TLS_ENABLED', originalTls], ['REDIS_PASSWORD', originalPassword], ['REDIS_TLS_CA_CERTS', originalCa]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('bullConnection reflects TLS and password from the environment', () => {
    process.env.REDIS_TLS_ENABLED = 'true';
    process.env.REDIS_PASSWORD = 'p';
    const { bullConnection } = load();

    expect(bullConnection()).toEqual({
      url: 'redis://localhost:6379',
      password: 'p',
      tls: {},
      maxRetriesPerRequest: null
    });
  });

  it('bullConnection omits password and tls by default but keeps maxRetriesPerRequest null', () => {
    delete process.env.REDIS_TLS_ENABLED;
    delete process.env.REDIS_PASSWORD;
    const { bullConnection } = load();
    const conn = bullConnection();

    expect(conn.password).toBeUndefined();
    expect(conn.tls).toBeUndefined();
    expect(conn.maxRetriesPerRequest).toBeNull();
  });

  it('nodeRedisOptions keeps the shape redisClient.js used', () => {
    process.env.REDIS_TLS_ENABLED = 'true';
    process.env.REDIS_PASSWORD = 'p';
    process.env.REDIS_TLS_CA_CERTS = 'ca-pem';
    const { nodeRedisOptions } = load();

    expect(nodeRedisOptions()).toEqual({
      url: 'redis://localhost:6379',
      password: 'p',
      socket: { tls: true, ca: 'ca-pem', key: undefined, cert: undefined }
    });
  });
});
