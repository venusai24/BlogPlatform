const crypto = require('crypto');

// Deterministic UUID generator based on base string and index
// Produces valid UUID v4-like string (using md5 hex segments) acceptable to Qdrant
const generateChunkUuid = (baseId, idx) => {
  const hash = crypto.createHash('md5').update(`${baseId}-${idx}`).digest('hex');
  return `${hash.substr(0,8)}-${hash.substr(8,4)}-${hash.substr(12,4)}-${hash.substr(16,4)}-${hash.substr(20,12)}`;
};

module.exports = { generateChunkUuid };
