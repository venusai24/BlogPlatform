const config = require('../../src/config');

/**
 * VectorStore interface. Every backend (qdrantStore.js, s3VectorsStore.js) implements:
 *
 *   ensureCollections(dim)                    create/verify the three collections (titles, content, summaries)
 *   upsert(collection, points)                points: [{ id, vector, payload }]; resolves once durable
 *   deleteByIds(collection, ids)              ids: string[]
 *   deleteByPost(collection, postId)          delete every point belonging to the post; errors propagate
 *   search(collection, vector, limit)         -> [{ id, score, payload }], best first (score: higher is closer)
 *   listPostIds()                             -> AsyncIterable<string> of every indexed post id (used by reconciliation)
 */

const STORES = {
    qdrant: () => require('./qdrantStore'),
    s3vectors: () => require('./s3VectorsStore')
};

let onlyStore = null;

// Returns the store selected by VECTOR_STORE (default 'qdrant'). All reads go here.
function getVectorStore() {
    const load = STORES[config.vectorStore];
    if (!load) {
        throw new Error(`Unsupported VECTOR_STORE: ${config.vectorStore}`);
    }
    return load();
}

// Stores that receive writes. VECTOR_STORE_WRITE=both fills Qdrant and S3 Vectors during a migration.
function getWriteStores() {
    if (onlyStore) return [STORES[onlyStore]()];
    if (config.vectorStoreWrite === 'both') return [STORES.qdrant(), STORES.s3vectors()];
    return [getVectorStore()];
}

// Every store the app depends on, so startup can verify them all.
function getEnsureStores() {
    const read = getVectorStore();
    return [read, ...getWriteStores().filter(store => store !== read)];
}

// Backfills (scripts/reindex.js --store ...) write to one store only.
function useOnlyStore(name) {
    if (!STORES[name]) {
        throw new Error(`Unknown store: ${name}`);
    }
    onlyStore = name;
}

module.exports = { getVectorStore, getWriteStores, getEnsureStores, useOnlyStore };
