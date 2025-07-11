require('dotenv').config();
const Groq = require("groq-sdk");
const redis = require("redis");
const crypto = require("crypto");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let redisClient;
let redisEnabled = true;

(async () => {
  try {
    redisClient = redis.createClient();
    await redisClient.connect();
    console.log("Connected to Redis server for embeddings.");
  } catch (error) {
    console.error("Failed to connect to Redis server. Embedding caching disabled.", error);
    redisEnabled = false;
  }
})();

const generateEmbeddingKey = (text) => 
  `embedding:${crypto.createHash("sha256").update(text).digest("hex")}`;

// Alternative: Use OpenAI embeddings (more accurate)
const generateEmbeddingWithOpenAI = async (text) => {
  // You'll need to install: npm install openai
  const { Configuration, OpenAIApi } = require("openai");
  
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  try {
    const response = await openai.createEmbedding({
      model: "text-embedding-ada-002",
      input: text,
    });
    
    return response.data.data[0].embedding;
  } catch (error) {
    console.error("OpenAI embedding error:", error);
    throw error;
  }
};

// Simple embedding using sentence transformers approach with Groq
const generateEmbedding = async (text) => {
  console.log("=== EMBEDDING GENERATION DEBUG START ===");
  console.log("Input text:", text);
  console.log("Input text type:", typeof text);
  console.log("Input text length:", text ? text.length : 'N/A');
  
  // Validate input
  if (!text || typeof text !== 'string') {
    console.error("Invalid input text:", text);
    throw new Error("Invalid input text for embedding generation");
  }

  const embeddingKey = generateEmbeddingKey(text);
  console.log("Generated embedding key:", embeddingKey);
  
  if (redisEnabled) {
    try {
      const cached = await redisClient.get(embeddingKey);
      if (cached) {
        console.log("Found cached embedding");
        const parsedCached = JSON.parse(cached);
        console.log("Cached embedding length:", parsedCached.length);
        console.log("Cached embedding sample:", parsedCached.slice(0, 5));
        return parsedCached;
      }
    } catch (error) {
      console.error("Redis error while fetching embedding:", error);
    }
  }

  console.log("No cached embedding found, generating new one...");

  try {
    // Use Groq to generate a semantic representation
    const groqRequest = {
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a semantic analyzer. Generate a comma-separated list of exactly 384 numerical values between -1 and 1 that represent the semantic meaning of the given text. Focus on key concepts, themes, and meaning. Return ONLY the comma-separated numbers, no other text or formatting."
        },
        {
          role: "user",
          content: `Generate semantic embedding for: ${text.substring(0, 2000)}`
        }
      ],
      max_tokens: 1000,
      temperature: 0.1,
    };

    console.log("Groq request:", JSON.stringify(groqRequest, null, 2));

    const response = await groq.chat.completions.create(groqRequest);
    
    console.log("Groq response:", JSON.stringify(response, null, 2));
    
    const embeddingText = response.choices[0].message?.content?.trim();
    console.log("Raw embedding text from Groq:", embeddingText);
    console.log("Embedding text type:", typeof embeddingText);
    console.log("Embedding text length:", embeddingText ? embeddingText.length : 'N/A');
    
    if (!embeddingText) {
      console.error("No embedding text received from Groq");
      throw new Error("No embedding text received from Groq");
    }

    // Split and parse the embedding
    const embeddingStrings = embeddingText.split(',');
    console.log("Split embedding strings count:", embeddingStrings.length);
    console.log("First 10 embedding strings:", embeddingStrings.slice(0, 10));
    
    const embedding = embeddingStrings.map((num, index) => {
      const trimmed = num.trim();
      const parsed = parseFloat(trimmed);
      if (isNaN(parsed)) {
        console.error(`Invalid number at index ${index}: "${trimmed}"`);
      }
      return parsed;
    }).slice(0, 384);
    
    console.log("Parsed embedding length:", embedding.length);
    console.log("First 10 parsed values:", embedding.slice(0, 10));
    console.log("NaN count in embedding:", embedding.filter(isNaN).length);
    console.log("Valid numbers count:", embedding.filter(x => !isNaN(x)).length);
    
    // Check for NaN values
    const hasNaN = embedding.some(isNaN);
    if (hasNaN) {
      console.error("Embedding contains NaN values!");
      console.error("NaN indices:", embedding.map((val, idx) => isNaN(val) ? idx : null).filter(x => x !== null));
      throw new Error("Generated embedding contains NaN values");
    }
    
    // Normalize the embedding
    const magnitudeSquared = embedding.reduce((sum, val) => sum + val * val, 0);
    console.log("Magnitude squared:", magnitudeSquared);
    
    if (magnitudeSquared === 0) {
      console.error("Zero magnitude embedding detected");
      throw new Error("Zero magnitude embedding");
    }
    
    const magnitude = Math.sqrt(magnitudeSquared);
    console.log("Magnitude:", magnitude);
    
    const normalizedEmbedding = embedding.map(val => val / magnitude);
    console.log("Normalized embedding length:", normalizedEmbedding.length);
    console.log("First 10 normalized values:", normalizedEmbedding.slice(0, 10));
    console.log("NaN count in normalized embedding:", normalizedEmbedding.filter(isNaN).length);

    // Final validation
    const isValidEmbedding = normalizedEmbedding.length === 384 && 
                           normalizedEmbedding.every(x => typeof x === "number" && !isNaN(x));
    console.log("Is valid embedding:", isValidEmbedding);

    if (!isValidEmbedding) {
      console.error("Final embedding validation failed");
      throw new Error("Final embedding validation failed");
    }

    if (redisEnabled) {
      try {
        await redisClient.set(embeddingKey, JSON.stringify(normalizedEmbedding), { EX: 86400 });
        console.log("Cached embedding in Redis");
      } catch (error) {
        console.error("Redis error while setting embedding:", error);
      }
    }

    console.log("=== EMBEDDING GENERATION DEBUG END ===");
    return normalizedEmbedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    console.error("Error stack:", error.stack);
    
    // Fallback: generate random normalized embedding
    console.log("Generating fallback random embedding...");
    const randomEmbedding = Array.from({length: 384}, () => (Math.random() - 0.5) * 2);
    const magnitude = Math.sqrt(randomEmbedding.reduce((sum, val) => sum + val * val, 0));
    const fallbackEmbedding = randomEmbedding.map(val => val / magnitude);
    
    console.log("Fallback embedding generated, length:", fallbackEmbedding.length);
    console.log("Fallback embedding sample:", fallbackEmbedding.slice(0, 5));
    
    return fallbackEmbedding;
  }
};

// Calculate cosine similarity between two embeddings
const cosineSimilarity = (vec1, vec2) => {
  if (vec1.length !== vec2.length) return 0;
  
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  
  return dotProduct / (magnitude1 * magnitude2);
};

module.exports = {
  generateEmbedding,
  cosineSimilarity,
  generateEmbeddingWithOpenAI
};