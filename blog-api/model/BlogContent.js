const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const blogcontentSchema = new Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: String, required: true },
    summary: { type: String }, 
    tags: [String],
    likes: { type: Number, default: 0 },
    comments: [
        {
            user: String,
            comment: String,
            timestamp: { type: Date, default: Date.now },
        },
    ],
}, { timestamps: true });

blogcontentSchema.index({ author: 1, title: 1 }, { unique: true });

module.exports = mongoose.model('BlogContent', blogcontentSchema);