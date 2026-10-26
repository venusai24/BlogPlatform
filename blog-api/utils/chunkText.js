const chunkText = (text, maxChars = 500, overlapRatio = 0.1) => {
  if (!text) return [];
  const overlapChars = Math.floor(maxChars * overlapRatio);
  const chunks = [];
  
  // Split by Markdown headers (keep header with content)
  const sections = text.split(/(?=^#{1,6}\s)/m);
  let previousOverlap = '';

  for (let section of sections) {
    section = section.trim();
    if (!section) continue;

    const paragraphs = section.split(/\n\n+/);
    let currentChunk = previousOverlap;

    for (let para of paragraphs) {
      para = para.trim();
      if (!para) continue;

      if (currentChunk.length + para.length > maxChars && currentChunk.trim() !== previousOverlap.trim()) {
        chunks.push(currentChunk.trim());
        
        // Find a good overlap (try not to cut mid-word)
        let overlapStart = Math.max(0, currentChunk.length - overlapChars);
        while (overlapStart > 0 && currentChunk[overlapStart] !== ' ' && currentChunk[overlapStart] !== '\n') {
            overlapStart--;
        }
        previousOverlap = currentChunk.substring(overlapStart).trim();
        
        currentChunk = previousOverlap + (previousOverlap ? '\n\n' : '') + para;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      }
    }
    
    if (currentChunk.trim() !== previousOverlap.trim()) {
      chunks.push(currentChunk.trim());
      
      let overlapStart = Math.max(0, currentChunk.length - overlapChars);
      while (overlapStart > 0 && currentChunk[overlapStart] !== ' ' && currentChunk[overlapStart] !== '\n') {
          overlapStart--;
      }
      previousOverlap = currentChunk.substring(overlapStart).trim();
    }
  }

  return chunks;
};

module.exports = { chunkText };
