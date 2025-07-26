const { QdrantClient } = require("@qdrant/js-client-rest");

let qdrantClient = null;
let isInitialized = false;

const getQdrantClient = () => {
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ 
            url: process.env.QDRANT_URL,
            apiKey: process.env.QDRANT_API_KEY,
        });
    }
    return qdrantClient;
};

const initQdrant = async () => {
    try {
        const client = getQdrantClient();
        const collectionName = process.env.QDRANT_COLLECTION_NAME;

        // Check if collection exists
        const collections = await client.getCollections();
        const collectionExists = collections.collections.some(
            c => c.name === collectionName
        );

        if (!collectionExists) {
            console.log(`Creating Qdrant collection "${collectionName}"...`);
            await client.createCollection(collectionName, {
                vectors: {
                    size: 384, // Dimension size for your embeddings
                    distance: "Cosine"
                },
                optimizers_config: {
                    default_segment_number: 2
                },
                replication_factor: 1
            });
            console.log(`Qdrant collection "${collectionName}" created successfully.`);
        }

        isInitialized = true;
        return client;
    } catch (error) {
        console.error("Error initializing Qdrant:", error);
        throw error;
    }
};

const getCollection = () => {
    if (!isInitialized) {
        throw new Error("Qdrant client not initialized");
    }
    return {
        client: getQdrantClient(),
        collectionName: process.env.QDRANT_COLLECTION_NAME
    };
};

module.exports = {
    getQdrantClient,
    initQdrant,
    getCollection
};