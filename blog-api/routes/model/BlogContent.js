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
}, { timestamps: true }); // Automatically adds createdAt and updatedAt fields

blogcontentSchema.index({ author: 1, title: 1 }, { unique: true }); // Compound index on author and title and allows different authors to have posts with the same title.

module.exports = mongoose.model('BlogContent', blogcontentSchema);
