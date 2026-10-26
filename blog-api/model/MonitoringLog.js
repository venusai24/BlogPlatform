const mongoose = require('mongoose');

const monitoringLogSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['RAG_GENERATION', 'RAG_FEEDBACK', 'RETRIEVAL_DRIFT'],
        required: true
    },
    // Common fields
    timestamp: {
        type: Date,
        default: Date.now
    },
    query: {
        type: String,
        required: function() { return this.type !== 'RAG_FEEDBACK'; }
    },
    
    // For RAG_GENERATION
    retrievedDocsCount: Number,
    generationLatencyMs: Number,
    totalCost: Number, // In USD based on tokens
    modelUsed: String,
    inputTokens: Number,
    outputTokens: Number,
    prompt: String,
    answer: String,
    error: String, // If graceful degradation occurred

    // For RAG_FEEDBACK
    generationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MonitoringLog'
    },
    feedbackScore: {
        type: Number, // e.g., 1 for thumbs up, -1 for thumbs down
        enum: [1, -1]
    },
    feedbackText: String,

    // For RETRIEVAL_DRIFT
    queryEmbedding: {
        type: [Number], // Storing query embedding to detect drift
        index: false
    }
}, { timestamps: true });

// Old telemetry expires on its own. Mongoose syncs this index on first boot (autoIndex).
monitoringLogSchema.index(
    { timestamp: 1 },
    { expireAfterSeconds: Number(process.env.MONITORING_LOG_TTL_DAYS || 30) * 86400 }
);

module.exports = mongoose.model('MonitoringLog', monitoringLogSchema);
