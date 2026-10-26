const mongoose = require('mongoose');

// Transactional outbox (ADR-001): written in the same Mongo transaction as the post,
// then published to SNS by a relay.
const outboxSchema = new mongoose.Schema({
    eventType: { type: String, required: true },
    aggregateId: { type: String, required: true }, // postId
    revision: { type: Number, required: true },
    envelope: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'published'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null }
}, { collection: 'outbox', timestamps: false });

outboxSchema.index({ status: 1, nextAttemptAt: 1 });
// Published rows are kept for 7 days (replay window), then expire.
outboxSchema.index(
    { publishedAt: 1 },
    { expireAfterSeconds: 604800, partialFilterExpression: { status: 'published' } }
);

module.exports = mongoose.model('Outbox', outboxSchema);
