const { v5: uuidv5 } = require('uuid');
const { NAMESPACE, COLLECTIONS, MAX_CONTENT_CHUNKS, titleId, chunkId, summaryId } = require('../pointIds');

describe('pointIds', () => {
  it('keeps the namespace and id scheme existing vectors were written with', () => {
    expect(NAMESPACE).toBe('1b671a64-40d5-491e-99b0-da01ff1f3341');
    expect(titleId('p1')).toBe(uuidv5('p1_title', NAMESPACE));
    expect(chunkId('p1', 3)).toBe(uuidv5('p1_content_3', NAMESPACE));
    expect(summaryId('p1')).toBe(uuidv5('p1_summary', NAMESPACE));
  });

  it('exposes the collection names and the chunk cap', () => {
    expect(COLLECTIONS).toEqual({ title: 'blog_titles', content: 'blog_content', summary: 'blog_summaries' });
    expect(MAX_CONTENT_CHUNKS).toBe(256);
  });
});
