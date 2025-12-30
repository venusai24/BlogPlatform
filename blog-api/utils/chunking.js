const splitIntoChunks = (text, maxTokens = 512, overlap = 0.25) => {
  const words = text.split(/\s+/);
  const chunks = [];
  const stride = Math.floor(maxTokens * (1 - overlap));
  for (let i = 0; i < words.length; i += stride) {
    const chunkText = words.slice(i, i + maxTokens).join(' ');
    if (chunkText.length < 50) continue;
    chunks.push({ text: chunkText, index: Math.floor(i / stride) });
    if (i + maxTokens >= words.length) break;
  }
  return chunks;
};

module.exports = { splitIntoChunks };
