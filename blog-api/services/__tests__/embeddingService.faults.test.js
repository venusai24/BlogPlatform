jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: { embedding: [0.1, 0.2] } }) }));

const axios = require('axios');
const config = require('../../src/config');
const { embed } = require('../embeddingService');

describe('embed fault injection', () => {
  const original = { ...config.faults };
  afterEach(() => {
    config.faults = { ...original };
    jest.clearAllMocks();
  });

  it('fails before doing any work when the fault rate is 1', async () => {
    config.faults = { ...original, embedErrorRate: 1 };

    await expect(embed(['hello'])).rejects.toMatchObject({ name: 'ThrottlingException' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('works normally when no fault is configured', async () => {
    await expect(embed(['hello'])).resolves.toEqual([[0.1, 0.2]]);
  });
});
