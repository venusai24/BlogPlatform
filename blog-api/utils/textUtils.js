// Remove repeated paragraphs, boilerplate, normalize whitespace
function preprocessText(text) {
    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const uniqueParagraphs = [...new Set(paragraphs)];
    const filtered = uniqueParagraphs.filter(p => !/copyright|footer|all rights reserved/i.test(p));
    return filtered.join('\n').replace(/\s+/g, ' ').trim();
}

// Adaptive chunking using sentence boundaries
function adaptiveChunkText(text, maxWords) {
    const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
    const chunks = [];
    let currentChunk = [];
    let currentWordCount = 0;
    for (const sentence of sentences) {
        const wordCount = sentence.split(/\s+/).length;
        if (currentWordCount + wordCount > maxWords && currentChunk.length > 0) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [sentence];
            currentWordCount = wordCount;
        } else {
            currentChunk.push(sentence);
            currentWordCount += wordCount;
        }
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }
    return chunks;
}

module.exports = {
    preprocessText,
    adaptiveChunkText
};
