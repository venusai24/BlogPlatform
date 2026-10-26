const { v5: uuidv5 } = require('uuid');

// Must never change: these ids are what existing vectors were written with, and the S3 Vectors store
// derives the keys it deletes from them.
const NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
const COLLECTIONS = { title: 'blog_titles', content: 'blog_content', summary: 'blog_summaries' };
const MAX_CONTENT_CHUNKS = 256;

const titleId = id => uuidv5(`${id}_title`, NAMESPACE);
const chunkId = (id, i) => uuidv5(`${id}_content_${i}`, NAMESPACE);
const summaryId = id => uuidv5(`${id}_summary`, NAMESPACE);

module.exports = { NAMESPACE, COLLECTIONS, MAX_CONTENT_CHUNKS, titleId, chunkId, summaryId };
