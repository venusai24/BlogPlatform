const mockSend = jest.fn();
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  keys: jest.fn().mockResolvedValue([])
};
const mockGenerateEmbedding = jest.fn().mockResolvedValue([0.1, 0.2]);

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockSend })),
  ConverseCommand: jest.fn(input => ({ input }))
}));
jest.mock('../redisClient', () => mockRedis);
jest.mock('../embeddingService', () => ({
  generateEmbedding: mockGenerateEmbedding,
  cosineSimilarity: jest.fn()
}));

describe('summarizeJob', () => {
  afterEach(() => {
    process.env.SUMMARY_PROVIDER = 'groq';
  });

  it('uses only the exact-hash cache: no Redis key scan and no embedding call', async () => {
    process.env.SUMMARY_PROVIDER = 'bedrock';
    mockSend.mockResolvedValue({ output: { message: { content: [{ text: 'Short summary.' }] } } });

    let summarize;
    jest.isolateModules(() => {
      summarize = require('../summarize');
    });
    const result = await summarize.summarizeJob({ text: 'a b c' });

    expect(result).toBe('Short summary.');
    expect(mockRedis.keys).not.toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(expect.stringMatching(/^full-text:/), 'Short summary.', { EX: 86400 });
  });

  it('no longer exports the semantic cache helpers', () => {
    process.env.SUMMARY_PROVIDER = 'bedrock';
    let summarize;
    jest.isolateModules(() => {
      summarize = require('../summarize');
    });
    expect(summarize.getSemanticCachedSummary).toBeUndefined();
    expect(summarize.setSemanticCachedSummary).toBeUndefined();
  });
});
