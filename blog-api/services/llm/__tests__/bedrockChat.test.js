const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockSend })),
  ConverseCommand: jest.fn(input => ({ input }))
}));

function loadBedrockChat() {
  process.env.LLM_PROVIDER = 'bedrock';
  let mod;
  jest.isolateModules(() => {
    mod = require('../bedrockChat');
  });
  return mod;
}

describe('bedrockChat', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });
  afterEach(() => {
    delete process.env.LLM_PROVIDER;
  });

  it('extracts text after a reasoningContent block', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            { reasoningContent: { reasoningText: { text: 'think' } } },
            { text: 'Answer' }
          ]
        }
      },
      usage: { inputTokens: 10, outputTokens: 3 }
    });
    const { chat } = loadBedrockChat();

    const result = await chat({ system: 'S', user: 'U', maxTokens: 50, temperature: 0.2 });

    expect(result).toEqual(expect.objectContaining({ text: 'Answer', inputTokens: 10, outputTokens: 3 }));
  });

  it('sends modelId, system and inferenceConfig', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'ok' }] } },
      usage: { inputTokens: 1, outputTokens: 1 }
    });
    const { chat } = loadBedrockChat();

    await chat({ system: 'S', user: 'U', maxTokens: 50, temperature: 0.2 });

    const sent = mockSend.mock.calls[0][0];
    expect(sent.input).toEqual({
      modelId: 'openai.gpt-oss-20b-1:0',
      system: [{ text: 'S' }],
      messages: [{ role: 'user', content: [{ text: 'U' }] }],
      inferenceConfig: { maxTokens: 50, temperature: 0.2 }
    });
  });

  it('extractConverseText joins every text block and ignores the rest', () => {
    const { extractConverseText } = loadBedrockChat();
    const text = extractConverseText({
      output: { message: { content: [{ reasoningContent: {} }, { text: 'A' }, { text: 'B' }] } }
    });
    expect(text).toBe('AB');
  });
});
