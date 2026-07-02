const app = require('./app');
require('./services/summarizeWorker');
const http = require('http');
const port = process.env.PORT || 5000;
const server = http.createServer(app);

const io = require('./socket').init(server);
io.on('connection', socket => {
  console.log('Client connected');
});

// Temporary migration: Reset all likes to 0 and empty likedBy
(async () => {
    try {
        const BlogContent = require('./model/BlogContent');
        const result = await BlogContent.updateMany({}, { $set: { likes: 0, likedBy: [] } });
        console.log(`[Migration] Reset likes to 0 for ${result.modifiedCount} blogs.`);
    } catch (err) {
        console.error("[Migration] Failed to reset likes:", err);
    }
})();

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

