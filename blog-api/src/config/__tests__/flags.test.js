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

describe('process-role config', () => {
  it('has safe defaults', () => {
    const config = loadConfig();
    expect(config.runWorkers).toBe(true);
    expect(config.mongoMaxPoolSize).toBe(10);
    expect(config.serviceName).toBe('api');
  });

  it('reads RUN_WORKERS, MONGO_MAX_POOL_SIZE and SERVICE_NAME', () => {
    const config = loadConfig({ RUN_WORKERS: 'false', MONGO_MAX_POOL_SIZE: '5', SERVICE_NAME: 'worker' });
    expect(config.runWorkers).toBe(false);
    expect(config.mongoMaxPoolSize).toBe(5);
    expect(config.serviceName).toBe('worker');
  });
});

describe('INDEXING_BACKEND', () => {
  it('defaults to bullmq', () => {
    expect(loadConfig().indexingBackend).toBe('bullmq');
  });

  it.each(['bullmq', 'both', 'events'])('accepts %s', (value) => {
    expect(loadConfig({ INDEXING_BACKEND: value }).indexingBackend).toBe(value);
  });

  it('exits 1 on an unknown value', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const error = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      loadConfig({ INDEXING_BACKEND: 'kafka' });
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});

describe('vector store config', () => {
  it('defaults to Qdrant, primary writes and no bucket', () => {
    const config = loadConfig();
    expect(config.vectorStore).toBe('qdrant');
    expect(config.vectorStoreWrite).toBe('primary');
    expect(config.s3VectorsBucket).toBeUndefined();
  });

  it('reads VECTOR_STORE, VECTOR_STORE_WRITE and S3_VECTORS_BUCKET', () => {
    const config = loadConfig({ VECTOR_STORE: 's3vectors', VECTOR_STORE_WRITE: 'both', S3_VECTORS_BUCKET: 'b' });
    expect(config.vectorStore).toBe('s3vectors');
    expect(config.vectorStoreWrite).toBe('both');
    expect(config.s3VectorsBucket).toBe('b');
  });

  it.each([['VECTOR_STORE', 'pinecone'], ['VECTOR_STORE_WRITE', 'everywhere']])('exits 1 on an invalid %s', (name, value) => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      loadConfig({ [name]: value });
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      write.mockRestore();
    }
  });
});
