/**
 * Calculate similarity score between query and title
 * Lower score = better match
 * @param {string} query - The search query
 * @param {string} title - The blog title to compare against
 * @returns {number} - Similarity score (lower is better)
 */
function calculateTitleScore(query, title) {
    if (!query || !title) {
        return Infinity;
    }
    
    // Convert to lowercase for case-insensitive comparison
    const queryLower = query.toLowerCase().trim();
    const titleLower = title.toLowerCase().trim();
    
    // Exact match gets the best score
    if (queryLower === titleLower) {
        return 0;
    }
    
    // Check if title contains the entire query
    if (titleLower.includes(queryLower)) {
        return 1;
    }
    
    // Check if query contains the entire title
    if (queryLower.includes(titleLower)) {
        return 2;
    }
    
    // Split into words and calculate word-based similarity
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0);
    const titleWords = titleLower.split(/\s+/).filter(word => word.length > 0);
    
    if (queryWords.length === 0 || titleWords.length === 0) {
        return Infinity;
    }
    
    // Calculate Jaccard similarity coefficient
    const querySet = new Set(queryWords);
    const titleSet = new Set(titleWords);
    
    const intersection = new Set([...querySet].filter(word => titleSet.has(word)));
    const union = new Set([...querySet, ...titleSet]);
    
    const jaccardSimilarity = intersection.size / union.size;
    
    // Convert to distance (lower is better)
    const jaccardDistance = 1 - jaccardSimilarity;
    
    // If no common words, use Levenshtein distance as fallback
    if (intersection.size === 0) {
        const levenshteinDistance = calculateLevenshteinDistance(queryLower, titleLower);
        const maxLength = Math.max(queryLower.length, titleLower.length);
        const normalizedLevenshtein = levenshteinDistance / maxLength;
        
        // Return a higher score to rank it lower
        return 10 + normalizedLevenshtein;
    }
    
    // Return Jaccard distance (scaled to be in range 3-10)
    return 3 + (jaccardDistance * 7);
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Levenshtein distance
 */
function calculateLevenshteinDistance(str1, str2) {
    const matrix = [];
    
    // Initialize first row and column
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    // Fill in the rest of the matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

/**
 * Calculate fuzzy string similarity using multiple algorithms
 * @param {string} query - The search query
 * @param {string} text - The text to compare against
 * @returns {number} - Similarity score (0-1, higher is better)
 */
function calculateFuzzyScore(query, text) {
    if (!query || !text) {
        return 0;
    }
    
    const queryLower = query.toLowerCase().trim();
    const textLower = text.toLowerCase().trim();
    
    // Exact match
    if (queryLower === textLower) {
        return 1;
    }
    
    // Contains match
    if (textLower.includes(queryLower)) {
        return 0.8;
    }
    
    // Word-based similarity
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0);
    const textWords = textLower.split(/\s+/).filter(word => word.length > 0);
    
    if (queryWords.length === 0 || textWords.length === 0) {
        return 0;
    }
    
    const querySet = new Set(queryWords);
    const textSet = new Set(textWords);
    
    const intersection = new Set([...querySet].filter(word => textSet.has(word)));
    const union = new Set([...querySet, ...textSet]);
    
    return intersection.size / union.size;
}

module.exports = {
    calculateTitleScore,
    calculateLevenshteinDistance,
    calculateFuzzyScore
};