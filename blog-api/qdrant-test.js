require('dotenv').config();
const { getQdrantClient, initQdrant } = require('./services/qdrantService');
const { v4: uuidv4 } = require('uuid'); // Add UUID package

async function main() {
    console.log('--- Qdrant Standalone Test Script ---');
    
    try {
        // 1. Initialize Qdrant
        await initQdrant();
        console.log('Qdrant initialized successfully');

        const client = getQdrantClient();
        const collectionName = process.env.QDRANT_COLLECTION_NAME;

        // 2. Test point insertion
        const pointId = uuidv4(); // Generate UUID for point ID
        const testPoint = {
            id: pointId,
            vector: new Array(384).fill(0.1),
            payload: {
                text: 'Test document',
                metadata: { test: true }
            }
        };

        await client.upsert(collectionName, {
            points: [testPoint]
        });
        console.log('Test point inserted successfully');

        // 3. Test search
        const searchResult = await client.search(collectionName, {
            vector: new Array(384).fill(0.1),
            limit: 1
        });
        console.log('Search test successful:', searchResult);

        // 4. Clean up test data
        await client.delete(collectionName, {
            points: [pointId]
        });
        console.log('Test cleanup successful');

    } catch (error) {
        console.error('Test failed:', error);
        console.error('Error details:', error.data?.status?.error || error.message);
    }
}

main();