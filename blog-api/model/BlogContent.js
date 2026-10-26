const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const blogcontentSchema = new Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: String, required: true },
    summary: { type: String }, 
    tags: [String],
    likes: { type: Number, default: 0 },
    likedBy: [{ type: String }],
    // Bumped on every write. Documents created before this field count as revision 0.
    revision: { type: Number, default: 0 },
    // Set by the indexer after it embeds a given revision.
    indexedRevision: { type: Number },
    indexedChunkCount: { type: Number },
    indexedAt: { type: Date },
    comments: [
        {
            user: String,
            comment: String,
            timestamp: { type: Date, default: Date.now },
            replies: [
                {
                    user: String,
                    reply: String,
                    timestamp: { type: Date, default: Date.now },
                }
            ]
        },
    ],
}, { timestamps: true });

blogcontentSchema.index({ author: 1, title: 1 }, { unique: true });
blogcontentSchema.index({ title: 'text', content: 'text' });

module.exports = mongoose.model('BlogContent', blogcontentSchema);