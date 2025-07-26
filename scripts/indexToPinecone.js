require('dotenv').config();
const mongoose = require('mongoose');
const { initPinecone, indexAllExistingBlogs } = require('../blog-api/services/pineconeService');

async function main() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.DATABASE_URI);
        console.log('Connected to MongoDB');

        // Initialize Pinecone
        await initPinecone();

        // Index all blogs
        await indexAllExistingBlogs();

        console.log('Indexing completed successfully');
    } catch (error) {
        console.error('Error during indexing:', error);
    } finally {
        // Close MongoDB connection
        await mongoose.disconnect();
        process.exit(0);
    }
}

main();
