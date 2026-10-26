const {
    S3VectorsClient,
    GetIndexCommand,
    PutVectorsCommand,
    DeleteVectorsCommand,
    QueryVectorsCommand,
    ListVectorsCommand
} = require('@aws-sdk/client-s3vectors');
const config = require('../../src/config');
const { titleId, chunkId, summaryId, MAX_CONTENT_CHUNKS } = require('../indexing/pointIds');

// The vector bucket and its three indexes are created by Terraform (infra/persistent/vectors.tf),
// so this store only verifies they exist.
const INDEXES = {
    blog_titles: 'blog-titles',
    blog_content: 'blog-content',
    blog_summaries: 'blog-summaries'
};
const BATCH_SIZE = 500; // PutVectors and DeleteVectors accept at most 500 per call
const LIST_PAGE_SIZE = 500;

let client = null;
function getClient() {
    if (!client) client = new S3VectorsClient({ region: config.awsRegion });
    return client;
}

function bucket() {
    if (!config.s3VectorsBucket) {
        throw new Error('S3_VECTORS_BUCKET is not set');
    }
    return config.s3VectorsBucket;
}

function indexFor(collection) {
    const name = INDEXES[collection];
    if (!name) throw new Error(`Unknown collection: ${collection}`);
    return name;
}

function* batches(items) {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        yield items.slice(i, i + BATCH_SIZE);
    }
}

async function ensureCollections(dim) {
    for (const indexName of Object.values(INDEXES)) {
        let response;
        try {
            response = await getClient().send(new GetIndexCommand({ vectorBucketName: bucket(), indexName }));
        } catch (err) {
            if (err.name === 'NotFoundException') {
                throw new Error(
                    `S3 Vectors index "${indexName}" does not exist in bucket "${bucket()}". ` +
                    'The persistent stack creates it (infra/persistent/vectors.tf): apply that stack first.'
                );
            }
            throw err;
        }
        const existingDim = response?.index?.dimension;
        if (existingDim && existingDim !== dim) {
            throw new Error(`S3 Vectors index "${indexName}" has dimension ${existingDim}, but EMBEDDING_DIM is ${dim}`);
        }
    }
}

async function upsert(collection, points) {
    const indexName = indexFor(collection);
    bucket(); // fail fast when misconfigured, even for an empty batch
    for (const batch of batches(points)) {
        await getClient().send(new PutVectorsCommand({
            vectorBucketName: bucket(),
            indexName,
            vectors: batch.map(({ id, vector, payload }) => ({
                key: id,
                data: { float32: vector },
                metadata: payload
            }))
        }));
    }
}

async function deleteByIds(collection, ids) {
    const indexName = indexFor(collection);
    for (const batch of batches(ids)) {
        await getClient().send(new DeleteVectorsCommand({ vectorBucketName: bucket(), indexName, keys: batch }));
    }
}

// There is no filter-delete, so delete the post's deterministic keys. This relies on DeleteVectors
// succeeding for keys that do not exist (verified by a human smoke check before the migration).
async function deleteByPost(collection, postId) {
    let keys;
    if (collection === 'blog_titles') {
        keys = [titleId(postId)];
    } else if (collection === 'blog_summaries') {
        keys = [summaryId(postId)];
    } else if (collection === 'blog_content') {
        keys = Array.from({ length: MAX_CONTENT_CHUNKS }, (_, i) => chunkId(postId, i));
    } else {
        throw new Error(`Unknown collection: ${collection}`);
    }
    await deleteByIds(collection, keys);
}

async function search(collection, vector, limit) {
    const response = await getClient().send(new QueryVectorsCommand({
        vectorBucketName: bucket(),
        indexName: indexFor(collection),
        topK: limit,
        queryVector: { float32: vector },
        returnMetadata: true,
        returnDistance: true
    }));
    // Cosine distance is 1 - similarity.
    return (response.vectors || []).map(({ key, distance, metadata }) => ({
        id: key,
        score: 1 - distance,
        payload: metadata
    }));
}

async function* listPostIds() {
    let nextToken;
    do {
        const request = {
            vectorBucketName: bucket(),
            indexName: INDEXES.blog_titles,
            returnMetadata: true,
            maxResults: LIST_PAGE_SIZE
        };
        if (nextToken) request.nextToken = nextToken;
        const page = await getClient().send(new ListVectorsCommand(request));
        for (const vector of page.vectors || []) {
            if (vector.metadata && vector.metadata.blogId) yield vector.metadata.blogId;
        }
        nextToken = page.nextToken;
    } while (nextToken);
}

module.exports = { ensureCollections, upsert, deleteByIds, deleteByPost, search, listPostIds };
