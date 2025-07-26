const { QdrantClient } = require("@qdrant/js-client-rest");
require('dotenv').config();

const COLLECTION_NAME = 'blog-platform';

async function initializeQdrant() {
  try {
    const client = new QdrantClient({ 
      url: process.env.QDRANT_URL || 'http://localhost:6333'
    });

    // Create collection with the correct vector size (384 for MiniLM-L6-v2)
    await client.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 384,
        distance: "Cosine"
      }
    });

    // Create payload index for faster filtering
    await client.createPayloadIndex(COLLECTION_NAME, {
      field_name: "type",
      field_schema: "keyword"
    });

    console.log('Qdrant collection initialized successfully');
  } catch (error) {
    console.error('Error initializing Qdrant:', error);
  }
}

initializeQdrant();