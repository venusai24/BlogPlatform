const mockGroqChat = jest.fn().mockResolvedValue({ text: 'ok', inputTokens: 1, outputTokens: 1 });

jest.mock('../groqChat', () => ({ chat: (...args) => mockGroqChat(...args) }));
jest.mock('../bedrockChat', () => ({ chat: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const config = require('../../../src/config');
const { getChatClient } = require('../index');

describe('chat client fault injection', () => {
  const original = { ...config.faults };
  afterEach(() => {
    config.faults = { ...original };
    jest.clearAllMocks();
  });

  it('passes calls through when no fault is configured', async () => {
    const result = await getChatClient().chat({ system: 's', user: 'u' });

    expect(result.text).toBe('ok');
    expect(mockGroqChat).toHaveBeenCalledWith({ system: 's', user: 'u' });
  });

  it('fails before calling the provider when the llm fault rate is 1', async () => {
    config.faults = { ...original, llmErrorRate: 1 };

    await expect(getChatClient().chat({ system: 's', user: 'u' })).rejects.toMatchObject({ name: 'FaultInjectedError' });
    expect(mockGroqChat).not.toHaveBeenCalled();
  });
});
