const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const blogcontentSchema = new Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: String, required: true },
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

module.exports = mongoose.model('BlogContent', blogcontentSchema);