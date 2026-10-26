const { QdrantClient } = require('@qdrant/js-client-rest');
const config = require('../../src/config');
const logger = require('../../src/utils/logger');

const COLLECTIONS = ['blog_titles', 'blog_content', 'blog_summaries'];
const SCROLL_PAGE_SIZE = 256;

let client = null;

// Shared client: the app, the indexer and the readiness probe all use this one instance.
function getClient() {
    if (!client) {
        client = new QdrantClient({ url: config.qdrantUrl, apiKey: config.qdrantApiKey });
    }
    return client;
}

async function ensureCollections(dim) {
    const qdrant = getClient();

    let existing;
    try {
        existing = await qdrant.getCollections();
    } catch (err) {
        // Let the app start without Qdrant; search falls back to Mongo text search.
        logger.warn({ err }, 'Could not fetch Qdrant collections. Assuming Qdrant is unreachable.');
        return;
    }
    const existingNames = existing.collections.map(c => c.name);

    for (const name of COLLECTIONS) {
        if (existingNames.includes(name)) {
            const info = await qdrant.getCollection(name);
            const vectors = info.config.params.vectors;
            const existingDim = vectors ? vectors.size : null;
            if (existingDim && existingDim !== dim) {
                logger.error(`Collection ${name} has dimension ${existingDim}, but EMBEDDING_DIM is ${dim}. Please delete and reindex.`);
                throw new Error(`Qdrant dimension mismatch for ${name}`);
            }
        } else {
            logger.info(`Creating Qdrant collection "${name}" with dim ${dim}...`);
            await qdrant.createCollection(name, { vectors: { size: dim, distance: 'Cosine' } });
        }

        // Filtering/deleting by blogId scans the whole collection without a payload index.
        try {
            await qdrant.createPayloadIndex(name, { field_name: 'blogId', field_schema: 'keyword', wait: true });
        } catch (err) {
            if (!/already exists/i.test(String(err.message))) throw err;
        }
    }
}

async function upsert(collection, points) {
    await getClient().upsert(collection, { wait: true, points });
}

async function deleteByIds(collection, ids) {
    await getClient().delete(collection, { wait: true, points: ids });
}

async function deleteByPost(collection, postId) {
    await getClient().delete(collection, {
        wait: true,
        filter: { must: [{ key: 'blogId', match: { value: postId.toString() } }] }
    });
}

async function search(collection, vector, limit) {
    const results = await getClient().search(collection, {
        vector,
        limit,
        with_payload: true,
        with_vectors: false
    });
    return results.map(({ id, score, payload }) => ({ id, score, payload }));
}

async function* listPostIds() {
    let offset;
    do {
        const request = { with_payload: ['blogId'], with_vector: false, limit: SCROLL_PAGE_SIZE };
        if (offset !== undefined && offset !== null) request.offset = offset;
        const page = await getClient().scroll('blog_titles', request);
        for (const point of page.points) {
            if (point.payload && point.payload.blogId) yield point.payload.blogId;
        }
        offset = page.next_page_offset;
    } while (offset !== undefined && offset !== null);
}

module.exports = { getClient, ensureCollections, upsert, deleteByIds, deleteByPost, search, listPostIds };
