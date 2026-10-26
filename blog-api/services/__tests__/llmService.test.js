const mockChat = jest.fn();
const mockLogRagGeneration = jest.fn();

jest.mock('../llm', () => ({ getChatClient: () => ({ chat: mockChat }) }));
jest.mock('../monitoringService', () => ({ logRagGeneration: mockLogRagGeneration }));
jest.mock('../redisClient', () => ({ isOpen: false }));
jest.mock('../../src/utils/metrics', () => ({ emitMetric: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { emitMetric } = require('../../src/utils/metrics');

const SNIPPETS = [{ title: 'T1', snippet: 'S1' }];

function loadService(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    let svc;
    jest.isolateModules(() => {
      svc = require('../llmService');
    });
    return svc;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('llmService', () => {
  beforeEach(() => {
    mockChat.mockReset();
    emitMetric.mockClear();
    mockLogRagGeneration.mockReset().mockResolvedValue('g1');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generateRagAnswer uses the configured chat client', async () => {
    mockChat.mockResolvedValue({ text: 'A', inputTokens: 100, outputTokens: 20 });
    const svc = loadService();

    const result = await svc.generateRagAnswer('q', SNIPPETS);

    expect(result).toEqual({ answer: 'A', generationId: 'g1' });
    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 150, temperature: 0.2 }));
  });

  it('cost uses configured prices', async () => {
    mockChat.mockResolvedValue({ text: 'A', inputTokens: 100, outputTokens: 20 });
    const svc = loadService({ LLM_PRICE_IN_PER_MTOK: '0.15', LLM_PRICE_OUT_PER_MTOK: '0.6' });

    await svc.generateRagAnswer('q', SNIPPETS);

    const logged = mockLogRagGeneration.mock.calls[0][0];
    expect(logged.totalCost).toBeCloseTo((100 * 0.15) / 1e6 + (20 * 0.6) / 1e6, 12);
    expect(logged.inputTokens).toBe(100);
    expect(logged.outputTokens).toBe(20);
  });

  it('falls back to snippets when chat throws', async () => {
    mockChat.mockRejectedValue(new Error('boom'));
    const svc = loadService();

    const result = await svc.generateRagAnswer('q', SNIPPETS);

    expect(result.answer.startsWith("I'm currently experiencing high latency")).toBe(true);
    expect(result.answer).toContain('T1');
  });

  it('transformQuery returns the chat text, or the original query on failure', async () => {
    const svc = loadService();
    mockChat.mockResolvedValueOnce({ text: 'rewritten', inputTokens: 1, outputTokens: 1 });
    await expect(svc.transformQuery('q')).resolves.toBe('rewritten');

    mockChat.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.transformQuery('q')).resolves.toBe('q');
  });

  it('transformQuery clears its abort timer when the chat call fails', async () => {
    jest.useFakeTimers();
    try {
      const svc = loadService();
      mockChat.mockRejectedValueOnce(new Error('boom'));
      await svc.transformQuery('q');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('emits LlmLatencyMs for a successful answer and no fallback metric', async () => {
    mockChat.mockResolvedValue({ text: 'A', inputTokens: 1, outputTokens: 1 });
    const svc = loadService();

    await svc.generateRagAnswer('q', SNIPPETS);

    expect(emitMetric).toHaveBeenCalledWith('LlmLatencyMs', expect.any(Number), 'Milliseconds');
    expect(emitMetric).not.toHaveBeenCalledWith('LlmFallback', expect.anything());
  });

  it('emits LlmFallback when the chat call fails', async () => {
    mockChat.mockRejectedValue(new Error('boom'));
    const svc = loadService();

    await svc.generateRagAnswer('q', SNIPPETS);

    expect(emitMetric).toHaveBeenCalledWith('LlmFallback', 1);
  });
});
