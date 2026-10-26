const config = require('../src/config');
const logger = require('../src/utils/logger');
const { getEnsureStores } = require('./vectorStore');

// The shared Qdrant client now lives in vectorStore/qdrantStore.js; the names below are kept for callers.
const getQdrantClient = () => require('./vectorStore/qdrantStore').getClient();

const initQdrant = async () => {
    try {
        for (const store of getEnsureStores()) {
            await store.ensureCollections(config.embedding.dim);
        }
        return getQdrantClient();
    } catch (error) {
        logger.error({ err: error }, 'Error initializing Qdrant');
        throw error;
    }
};

module.exports = {
    getQdrantClient,
    initQdrant
};
