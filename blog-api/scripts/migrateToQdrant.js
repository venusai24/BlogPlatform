const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const crypto = require('crypto');
const { pipeline } = require('@xenova/transformers');
const BlogContent = require('../model/BlogContent');
const { initQdrant, getQdrantClient } = require('../services/qdrantService');
const { generateEmbedding } = require('../services/embeddingService');

const COLLECTION_NAME = process.env.QDRANT_COLLECTION_NAME || 'blog-platform';

const ensureCollection = async (client) => {
    const collections = await client.getCollections();
    const exists = collections.collections?.some(c => c.name === COLLECTION_NAME);
    if (exists) return;
    await client.createCollection(COLLECTION_NAME, {
        vectors: { size: 384, distance: 'Cosine' }
    });
    await client.createPayloadIndex(COLLECTION_NAME, { field_name: 'type', field_schema: 'keyword' });
};

// Helper to convert DATABASE ObjectId to UUID for Qdrant
const objectIdToUuid = (objectId) => {
    const hash = crypto.createHash('md5').update(objectId.toString()).digest('hex');
    return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
};

const migrate = async () => {
    try {
        console.log('Starting migration...');

        // 1. Connect to DATABASE
        if (!process.env.DATABASE_URI) throw new Error('DATABASE_URI is not defined');
        await mongoose.connect(process.env.DATABASE_URI);
        console.log('Connected to DATABASE');

        // 2. Initialize Qdrant
        await initQdrant();
        const qdrant = getQdrantClient();
        await ensureCollection(qdrant);

        // 3. Load Embedding Model (384 dimensions)
        console.log('Loading embedding model (Xenova/all-MiniLM-L6-v2)...');
        const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

        // 4. Fetch Blogs
        const blogs = await BlogContent.find({});
        console.log(`Found ${blogs.length} blogs to migrate.`);

        if (blogs.length === 0) {
            console.log('No blogs found. Exiting.');
            return;
        }

        const points = [];

        // 5. Process Blogs
        for (const blog of blogs) {
            if (!blog?.content || !blog?.title) continue;

            const [titleEmbedding, contentEmbedding] = await Promise.all([
                generateEmbedding(blog.title),
                generateEmbedding(blog.content)
            ]);

            const idNum = parseInt(blog._id.toString().substring(0, 8), 16);

            points.push(
                {
                    id: idNum * 2,
                    vector: titleEmbedding,
                    payload: {
                        blogId: blog._id.toString(),
                        type: 'title',
                        title: blog.title,
                        snippet: blog.content.substring(0, 200),
                        author: blog.author || null
                    }
                },
                {
                    id: idNum * 2 + 1,
                    vector: contentEmbedding,
                    payload: {
                        blogId: blog._id.toString(),
                        type: 'content',
                        title: blog.title,
                        content: blog.content,
                        author: blog.author || null
                    }
                }
            );

            process.stdout.write('.'); // Progress indicator
        }
        console.log('\nEmbeddings generated.');

        // 6. Upsert to Qdrant
        console.log(`Upserting ${points.length} points to Qdrant collection "${COLLECTION_NAME}"...`);
        await qdrant.upsert(COLLECTION_NAME, {
            wait: true,
            points: points
        });

        console.log('Migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

migrate();
