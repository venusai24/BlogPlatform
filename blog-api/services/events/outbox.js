const mongoose = require('mongoose');
const Outbox = require('../../model/Outbox');
const { buildEnvelope } = require('./domainEvents');

// Appends a pending event. Call it inside the same transaction (`session`) as the write it describes.
async function appendEvent(session, { type, postId, revision, traceparent }) {
  const _id = new mongoose.Types.ObjectId();
  const now = new Date();
  await Outbox.create([{
    _id,
    eventType: type,
    aggregateId: postId,
    revision,
    envelope: buildEnvelope({ id: _id.toString(), type, postId, revision, time: now, traceparent }),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lockedUntil: null,
    lastError: null,
    createdAt: now,
    publishedAt: null
  }], { session });
}

module.exports = { appendEvent };
