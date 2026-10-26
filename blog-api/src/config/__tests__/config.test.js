describe('config required environment', () => {
  const saved = {};
  const KEYS = ['EMBEDDING_QUEUE_URL', 'ASYNC_EMBEDDING', 'INDEXING_QUEUE_URL'];
  let exitSpy;
  let errorSpy;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    errorSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not require EMBEDDING_QUEUE_URL or ASYNC_EMBEDDING', () => {
    delete process.env.EMBEDDING_QUEUE_URL;
    delete process.env.ASYNC_EMBEDDING;

    jest.isolateModules(() => {
      require('../index');
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('no longer exposes the embedding queue settings', () => {
    let config;
    jest.isolateModules(() => {
      config = require('../index');
    });

    expect(config).not.toHaveProperty('asyncEmbedding');
    expect(config).not.toHaveProperty('embeddingQueueUrl');
  });

  it('exposes INDEXING_QUEUE_URL as indexingQueueUrl', () => {
    process.env.INDEXING_QUEUE_URL = 'https://sqs.ap-south-1.amazonaws.com/1/q';
    let config;
    jest.isolateModules(() => {
      config = require('../index');
    });

    expect(config.indexingQueueUrl).toBe('https://sqs.ap-south-1.amazonaws.com/1/q');
  });
});
