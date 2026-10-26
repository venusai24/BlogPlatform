const { EVENT_TYPES, buildEnvelope } = require('../domainEvents');

describe('domainEvents', () => {
  it('exposes the three event types', () => {
    expect(EVENT_TYPES).toEqual({
      CREATED: 'blog.post.created',
      UPDATED: 'blog.post.updated',
      DELETED: 'blog.post.deleted'
    });
  });

  it('buildEnvelope matches the ADR-001 contract and has no traceparent key', () => {
    const envelope = buildEnvelope({
      id: 'x',
      type: 'blog.post.created',
      postId: 'p',
      revision: 1,
      time: new Date('2026-01-01T00:00:00Z')
    });

    expect(envelope).toEqual({
      specversion: '1.0',
      id: 'x',
      type: 'blog.post.created',
      source: 'blog-api',
      subject: 'p',
      time: '2026-01-01T00:00:00.000Z',
      datacontenttype: 'application/json',
      data: { postId: 'p', revision: 1 }
    });
    expect(envelope).not.toHaveProperty('traceparent');
  });

  it('includes traceparent when given', () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const envelope = buildEnvelope({ id: 'x', type: 'blog.post.updated', postId: 'p', revision: 2, traceparent });
    expect(envelope.traceparent).toBe(traceparent);
  });

  it.each([undefined, null, ''])('omits traceparent when it is %p', (traceparent) => {
    const envelope = buildEnvelope({ id: 'x', type: 'blog.post.updated', postId: 'p', revision: 2, traceparent });
    expect(envelope).not.toHaveProperty('traceparent');
  });

  it('defaults time to now', () => {
    const before = Date.now();
    const envelope = buildEnvelope({ id: 'x', type: 'blog.post.deleted', postId: 'p', revision: 3 });
    expect(new Date(envelope.time).getTime()).toBeGreaterThanOrEqual(before);
  });
});
