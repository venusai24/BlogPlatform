require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const BlogContent = require('../model/BlogContent');
const { indexBlogPost } = require('../services/semanticSearchService');
const { initQdrant } = require('../services/qdrantService');
const config = require('../src/config');
const redisClient = require('../services/redisClient');
const { useOnlyStore } = require('../services/vectorStore');

// Usage: node scripts/reindex.js [--store qdrant|s3vectors]
// --store writes to that store only, e.g. to backfill S3 Vectors while Qdrant keeps serving reads.
const storeFlag = process.argv.indexOf('--store');
if (storeFlag !== -1) {
    useOnlyStore(process.argv[storeFlag + 1]);
}

async function reindex() {
    try {
        await mongoose.connect(config.mongodbUri, {
            useUnifiedTopology: true,
            useNewUrlParser: true
        });
        console.log("Connected to MongoDB.");

        if (!redisClient.isOpen) {
            await redisClient.connect();
        }

        await initQdrant();
        console.log("Qdrant initialized.");

        // We can do this in batches using a cursor
        const cursor = BlogContent.find().cursor();
        let count = 0;
        
        for await (const blog of cursor) {
            console.log(`Reindexing blog ${blog._id}...`);
            await indexBlogPost(blog);
            count++;
        }

        console.log(`Successfully reindexed ${count} blog posts.`);
        
        await mongoose.connection.close();
        await redisClient.quit();
        process.exit(0);
    } catch (err) {
        console.error("Reindex error:", err);
        process.exit(1);
    }
}

reindex();
