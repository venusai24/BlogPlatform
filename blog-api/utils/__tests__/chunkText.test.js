const { chunkText } = require('../chunkText');

describe('chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(undefined)).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    expect(chunkText('Hello world.')).toEqual(['Hello world.']);
  });

  it('splits markdown sections and long text into bounded chunks', () => {
    const para = 'word '.repeat(60).trim(); // ~300 chars
    const text = `# One\n\n${para}\n\n${para}\n\n# Two\n\n${para}`;

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startsWith('# One')).toBe(true);
    expect(chunks.some(c => c.includes('# Two'))).toBe(true);
  });
});
