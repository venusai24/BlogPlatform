import parseTags from './parseTags';

describe('parseTags', () => {
  it('splits on commas and trims each tag', () => {
    expect(parseTags(' react , node,  aws ')).toEqual(['react', 'node', 'aws']);
  });

  it('returns an empty array for an empty or blank field', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags('   ')).toEqual([]);
  });

  it('drops empty entries from stray commas', () => {
    expect(parseTags('a,,b, ,')).toEqual(['a', 'b']);
  });

  it('handles a missing value', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(null)).toEqual([]);
  });
});
