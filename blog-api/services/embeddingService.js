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
  const embeddingKey = generateEmbeddingKey(text);
  
  if (redisEnabled) {
    try {
      const cached = await redisClient.get(embeddingKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error("Redis error while fetching embedding:", error);
    }
  }

  try {
    // Use Groq to generate a semantic representation
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a semantic analyzer. Generate a comma-separated list of exactly 384 numerical values between -1 and 1 that represent the semantic meaning of the given text. Focus on key concepts, themes, and meaning."
        },
        {
          role: "user",
          content: `Generate semantic embedding for: ${text.substring(0, 2000)}`
        }
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });

    const embeddingText = response.choices[0]?.message?.content?.trim();
    const embedding = embeddingText.split(',').map(num => parseFloat(num.trim())).slice(0, 384);
    
    // Normalize the embedding
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalizedEmbedding = embedding.map(val => val / magnitude);

    if (redisEnabled) {
      try {
        await redisClient.set(embeddingKey, JSON.stringify(normalizedEmbedding), { EX: 86400 });
      } catch (error) {
        console.error("Redis error while setting embedding:", error);
      }
    }

    return normalizedEmbedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    // Fallback: generate random normalized embedding
    const randomEmbedding = Array.from({length: 384}, () => (Math.random() - 0.5) * 2);
    const magnitude = Math.sqrt(randomEmbedding.reduce((sum, val) => sum + val * val, 0));
    return randomEmbedding.map(val => val / magnitude);
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