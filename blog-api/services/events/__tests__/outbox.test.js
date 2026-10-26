jest.mock('../../../model/Outbox', () => ({ create: jest.fn().mockResolvedValue([]) }));

const Outbox = require('../../../model/Outbox');
const { appendEvent } = require('../outbox');

describe('outbox.appendEvent', () => {
  beforeEach(() => Outbox.create.mockClear());

  it('creates one pending record inside the session, with the envelope id equal to its _id', async () => {
    const session = { id: 'sess' };

    await appendEvent(session, { type: 'blog.post.created', postId: 'p1', revision: 1 });

    expect(Outbox.create).toHaveBeenCalledTimes(1);
    const [docs, options] = Outbox.create.mock.calls[0];
    expect(options).toEqual({ session });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual(expect.objectContaining({
      eventType: 'blog.post.created',
      aggregateId: 'p1',
      revision: 1,
      status: 'pending',
      attempts: 0,
      lockedUntil: null,
      lastError: null,
      publishedAt: null
    }));
    expect(docs[0].nextAttemptAt).toBeInstanceOf(Date);
    expect(docs[0].createdAt).toBeInstanceOf(Date);
    expect(docs[0].envelope).toEqual(expect.objectContaining({
      id: docs[0]._id.toString(),
      type: 'blog.post.created',
      subject: 'p1',
      data: { postId: 'p1', revision: 1 }
    }));
    expect(docs[0].envelope).not.toHaveProperty('traceparent');
  });

  it('passes an optional traceparent through to the envelope', async () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

    await appendEvent({}, { type: 'blog.post.updated', postId: 'p1', revision: 2, traceparent });

    expect(Outbox.create.mock.calls[0][0][0].envelope.traceparent).toBe(traceparent);
  });
});
