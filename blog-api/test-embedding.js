// test-embedding.js
// Run this script to test embedding generation independently
// Usage: node test-embedding.js

require('dotenv').config();
const { generateEmbedding } = require('./services/embeddingService');

async function testEmbedding() {
    console.log("=== EMBEDDING TEST START ===");
    
    // Test with simple text
    const testTexts = [
        "Hello world",
        "This is a test blog post about technology and innovation.",
        "Summary: This article discusses the latest trends in AI and machine learning.",
        "" // Empty string test
    ];
    
    for (let i = 0; i < testTexts.length; i++) {
        const text = testTexts[i];
        console.log(`\n--- Test ${i + 1} ---`);
        console.log(`Input: "${text}"`);
        
        try {
            const embedding = await generateEmbedding(text);
            console.log(`Success! Embedding length: ${embedding.length}`);
            console.log(`Sample values: [${embedding.slice(0, 5).join(', ')}]`);
            console.log(`Has NaN: ${embedding.some(isNaN)}`);
            console.log(`All numbers: ${embedding.every(x => typeof x === 'number')}`);
        } catch (error) {
            console.error(`Error: ${error.message}`);
        }
    }
    
    console.log("\n=== EMBEDDING TEST END ===");
    process.exit(0);
}

testEmbedding().catch(console.error);