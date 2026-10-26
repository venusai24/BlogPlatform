describe('Outbox model', () => {
  const Outbox = require('../Outbox');

  it('uses the outbox collection', () => {
    expect(Outbox.collection.name).toBe('outbox');
  });

  it('indexes (status, nextAttemptAt) and TTLs published rows after 7 days', () => {
    const indexes = Outbox.schema.indexes();
    expect(indexes).toContainEqual([{ status: 1, nextAttemptAt: 1 }, expect.any(Object)]);
    expect(indexes).toContainEqual([
      { publishedAt: 1 },
      expect.objectContaining({
        expireAfterSeconds: 604800,
        partialFilterExpression: { status: 'published' }
      })
    ]);
  });

  it('defaults a new record to pending', () => {
    const doc = new Outbox({ eventType: 'blog.post.created', aggregateId: 'p', revision: 1, envelope: {} });
    expect(doc.status).toBe('pending');
    expect(doc.attempts).toBe(0);
    expect(doc.lockedUntil).toBeNull();
    expect(doc.publishedAt).toBeNull();
  });
});
