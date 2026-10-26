const BlogContent = require('../BlogContent');

describe('BlogContent revision tracking', () => {
  it('starts at revision 0 and has no indexed state', () => {
    const doc = new BlogContent({ title: 't', content: 'c', author: 'a' });
    expect(doc.revision).toBe(0);
    expect(doc.indexedRevision).toBeUndefined();
    expect(doc.indexedChunkCount).toBeUndefined();
    expect(doc.indexedAt).toBeUndefined();
  });

  it('can record indexing progress', () => {
    const doc = new BlogContent({
      title: 't', content: 'c', author: 'a',
      revision: 3, indexedRevision: 3, indexedChunkCount: 4, indexedAt: new Date()
    });
    expect(doc.indexedRevision).toBe(3);
    expect(doc.indexedChunkCount).toBe(4);
    expect(doc.indexedAt).toBeInstanceOf(Date);
  });
});
