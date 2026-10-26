const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockSend })),
  ConverseCommand: jest.fn(input => ({ input }))
}));

describe('summarizeText with the bedrock provider', () => {
  afterEach(() => {
    process.env.SUMMARY_PROVIDER = 'groq';
  });

  it('reads the text block that follows a reasoningContent block', async () => {
    process.env.SUMMARY_PROVIDER = 'bedrock';
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            { reasoningContent: { reasoningText: { text: 'thinking' } } },
            { text: ' A short summary. ' }
          ]
        }
      }
    });

    let summarizeText;
    jest.isolateModules(() => {
      summarizeText = require('../summarize');
    });

    await expect(summarizeText('one two three')).resolves.toBe('A short summary.');
  });
});
