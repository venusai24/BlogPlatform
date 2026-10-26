const EVENT_TYPES = {
  CREATED: 'blog.post.created',
  UPDATED: 'blog.post.updated',
  DELETED: 'blog.post.deleted'
};

// CloudEvents-style envelope, fixed by ADR-001. `traceparent` is the optional distributed-tracing
// extension: present only when a non-empty string is supplied.
function buildEnvelope({ id, type, postId, revision, time = new Date(), traceparent }) {
  const envelope = {
    specversion: '1.0',
    id,
    type,
    source: 'blog-api',
    subject: postId,
    time: time.toISOString(),
    datacontenttype: 'application/json'
  };
  if (typeof traceparent === 'string' && traceparent !== '') {
    envelope.traceparent = traceparent;
  }
  envelope.data = { postId, revision };
  return envelope;
}

module.exports = { EVENT_TYPES, buildEnvelope };
