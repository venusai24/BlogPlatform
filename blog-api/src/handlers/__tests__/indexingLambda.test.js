const mockSsmSend = jest.fn();
const mockConnectDB = jest.fn();
const mockHandle = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: (...args) => mockSsmSend(...args) })),
  GetParametersCommand: jest.fn(input => ({ input }))
}));
jest.mock('../../../config/dbConn', () => (...args) => mockConnectDB(...args));
jest.mock('../../../services/consumers/indexingConsumer', () => ({ handle: (...args) => mockHandle(...args) }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const SSM_PARAMS = [
  { Name: '/blogplatform/prod/mongodb_uri', Value: 'mongodb://from-ssm' },
  { Name: '/blogplatform/prod/jwt_secret', Value: 'jwt-from-ssm' },
  { Name: '/blogplatform/prod/qdrant_api_key', Value: 'qdrant-from-ssm' }
];
const record = (n, body = '{}') => ({ messageId: `m${n}`, body });

function loadHandler() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../indexingLambda');
  });
  return mod.handler;
}

describe('indexingLambda handler', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_ENV = 'prod';
    delete process.env.INDEXING_CONSUMER_MODE;
    mockSsmSend.mockResolvedValue({ Parameters: SSM_PARAMS });
    mockConnectDB.mockResolvedValue();
    mockHandle.mockResolvedValue();
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('reports only failed records', async () => {
    mockHandle.mockImplementation(async (message) => {
      if (message.MessageId === 'm2') throw new Error('poison');
    });
    const handler = loadHandler();

    const result = await handler({ Records: [record(1), record(2), record(3)] });

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'm2' }] });
    expect(mockHandle).toHaveBeenCalledTimes(3);
  });

  it('returns no failures when every record succeeds', async () => {
    const handler = loadHandler();
    await expect(handler({ Records: [record(1), record(2)] })).resolves.toEqual({ batchItemFailures: [] });
  });

  it('passes the record body and message id to the consumer, in active mode by default', async () => {
    const handler = loadHandler();

    await handler({ Records: [record(1, '{"a":1}')] });

    expect(mockHandle).toHaveBeenCalledWith({ Body: '{"a":1}', MessageId: 'm1' }, 'active');
  });

  it('honours INDEXING_CONSUMER_MODE', async () => {
    process.env.INDEXING_CONSUMER_MODE = 'shadow';
    const handler = loadHandler();

    await handler({ Records: [record(1)] });

    expect(mockHandle).toHaveBeenCalledWith(expect.anything(), 'shadow');
  });

  it('processes records one at a time, in order', async () => {
    const order = [];
    mockHandle.mockImplementation(async (message) => {
      order.push(`start:${message.MessageId}`);
      await new Promise(resolve => setImmediate(resolve));
      order.push(`end:${message.MessageId}`);
    });
    const handler = loadHandler();

    await handler({ Records: [record(1), record(2)] });

    expect(order).toEqual(['start:m1', 'end:m1', 'start:m2', 'end:m2']);
  });

  it('initialises once across invocations', async () => {
    const handler = loadHandler();

    await handler({ Records: [record(1)] });
    await handler({ Records: [record(2)] });

    expect(mockSsmSend).toHaveBeenCalledTimes(1);
    expect(mockConnectDB).toHaveBeenCalledTimes(1);
  });

  it('shares one initialisation between concurrent invocations', async () => {
    const handler = loadHandler();

    await Promise.all([handler({ Records: [record(1)] }), handler({ Records: [record(2)] })]);

    expect(mockSsmSend).toHaveBeenCalledTimes(1);
  });

  it('asks SSM for the three secrets, decrypted, under the app env prefix', async () => {
    const handler = loadHandler();

    await handler({ Records: [] });

    expect(mockSsmSend.mock.calls[0][0].input).toEqual({
      Names: [
        '/blogplatform/prod/mongodb_uri',
        '/blogplatform/prod/jwt_secret',
        '/blogplatform/prod/qdrant_api_key'
      ],
      WithDecryption: true
    });
  });

  it('loads secrets before requiring config', async () => {
    let seenWhenConnecting;
    mockConnectDB.mockImplementation(async () => {
      seenWhenConnecting = {
        MONGODB_URI: process.env.MONGODB_URI,
        JWT_SECRET: process.env.JWT_SECRET,
        QDRANT_API_KEY: process.env.QDRANT_API_KEY
      };
    });
    const handler = loadHandler();

    await handler({ Records: [] });

    expect(seenWhenConnecting).toEqual({
      MONGODB_URI: 'mongodb://from-ssm',
      JWT_SECRET: 'jwt-from-ssm',
      QDRANT_API_KEY: 'qdrant-from-ssm'
    });
  });

  it('does not require config at load time (it exits when secrets are missing)', () => {
    const requireSpy = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('../../config', () => { requireSpy(); return {}; });
      require('../indexingLambda');
    });
    expect(requireSpy).not.toHaveBeenCalled();
  });

  it('fails the invocation when a secret is missing, and retries initialisation next time', async () => {
    mockSsmSend.mockResolvedValueOnce({ Parameters: SSM_PARAMS.slice(0, 2) });
    const handler = loadHandler();

    await expect(handler({ Records: [record(1)] })).rejects.toThrow(/qdrant_api_key/);

    mockSsmSend.mockResolvedValue({ Parameters: SSM_PARAMS });
    await expect(handler({ Records: [record(1)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(mockSsmSend).toHaveBeenCalledTimes(2);
  });

  it('fails the invocation when the database connection fails', async () => {
    mockConnectDB.mockRejectedValueOnce(new Error('atlas unreachable'));
    const handler = loadHandler();

    await expect(handler({ Records: [record(1)] })).rejects.toThrow('atlas unreachable');
  });
});
