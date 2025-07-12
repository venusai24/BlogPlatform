require('dotenv').config();
const redis = require("redis");
const crypto = require("crypto");
const axios = require("axios");

// For local sentence transformers, you'll need to run a model server
// Alternative: Use Hugging Face Inference API
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"; // 384 dimensions
// Alternative models:
// "sentence-transformers/all-mpnet-base-v2" // 768 dimensions
// "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" // 384 dimensions

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

// Generate embedding using Hugging Face Inference API
const generateEmbeddingWithHuggingFace = async (text) => {
  
  try {
    const response = await axios.post('https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2', {
      inputs: text,
      options: {
        wait_for_model: true
      }
    }, {
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 seconds timeout
    });

    // The response is typically a 2D array, we want the first (and usually only) embedding
    const embedding = Array.isArray(response.data[0]) ? response.data[0] : response.data;
    
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Invalid embedding response from Hugging Face");
    }

    return embedding;
  } catch (error) {
    console.error("Hugging Face API error:", error.response?.data || error.message);
    throw error;
  }
};

// Generate embedding using local sentence transformers server
const generateEmbeddingWithLocalServer = async (text) => {
  const LOCAL_SERVER_URL = process.env.EMBEDDING_SERVER_URL || 'http://localhost:8000';
  
  try {
    const response = await axios.post(`${LOCAL_SERVER_URL}/embed`, {
      text: text
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const embedding = response.data.embedding;
    
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Invalid embedding response from local server");
    }

    return embedding;
  } catch (error) {
    console.error("Local server error:", error.response?.data || error.message);
    throw error;
  }
};

// Alternative: Use OpenAI embeddings (more accurate)
const generateEmbeddingWithOpenAI = async (text) => {
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

// Main embedding function using sentence transformers
const generateEmbedding = async (text) => {
  console.log("=== EMBEDDING GENERATION DEBUG START ===");
  console.log("Input text:", text ? text.substring(0, 100) + "..." : "N/A");
  console.log("Input text type:", typeof text);
  console.log("Input text length:", text ? text.length : 'N/A');
  
  // Validate input
  if (!text || typeof text !== 'string') {
    console.error("Invalid input text:", text);
    throw new Error("Invalid input text for embedding generation");
  }

  // Clean and truncate text if too long
  const cleanText = text.trim();
  const maxLength = 512; // Most sentence transformers work best with shorter texts
  const truncatedText = cleanText.length > maxLength ? cleanText.substring(0, maxLength) : cleanText;
  
  const embeddingKey = generateEmbeddingKey(truncatedText);
  console.log("Generated embedding key:", embeddingKey);
  
  // Check Redis cache first
  if (redisEnabled) {
    try {
      const cached = await redisClient.get(embeddingKey);
      if (cached) {
        console.log("Found cached embedding");
        const parsedCached = JSON.parse(cached);
        console.log("Cached embedding length:", parsedCached.length);
        console.log("=== EMBEDDING GENERATION DEBUG END (CACHED) ===");
        return parsedCached;
      }
    } catch (error) {
      console.error("Redis error while fetching embedding:", error);
    }
  }

  console.log("No cached embedding found, generating new one...");

  try {
    let embedding;
    
    // Try different embedding services in order of preference
    if (HUGGINGFACE_API_KEY) {
      console.log("Using Hugging Face API for embedding generation");
      embedding = await generateEmbeddingWithHuggingFace(truncatedText);
    } else if (process.env.EMBEDDING_SERVER_URL) {
      console.log("Using local sentence transformers server");
      embedding = await generateEmbeddingWithLocalServer(truncatedText);
    } else if (process.env.OPENAI_API_KEY) {
      console.log("Using OpenAI API for embedding generation");
      embedding = await generateEmbeddingWithOpenAI(truncatedText);
    } else {
      throw new Error("No embedding service configured. Please set HUGGINGFACE_API_KEY, EMBEDDING_SERVER_URL, or OPENAI_API_KEY");
    }
    
    console.log("Generated embedding length:", embedding.length);
    console.log("First 5 embedding values:", embedding.slice(0, 5));
    
    // Validate embedding
    const hasNaN = embedding.some(val => isNaN(val) || !isFinite(val));
    if (hasNaN) {
      console.error("Embedding contains invalid values!");
      throw new Error("Generated embedding contains invalid values");
    }
    
    // Ensure embedding is normalized (for cosine similarity)
    const magnitudeSquared = embedding.reduce((sum, val) => sum + val * val, 0);
    const magnitude = Math.sqrt(magnitudeSquared);
    
    let normalizedEmbedding;
    if (magnitude === 0) {
      console.warn("Zero magnitude embedding detected, using random normalized embedding");
      normalizedEmbedding = Array.from({length: embedding.length}, () => (Math.random() - 0.5) * 2);
      const randomMagnitude = Math.sqrt(normalizedEmbedding.reduce((sum, val) => sum + val * val, 0));
      normalizedEmbedding = normalizedEmbedding.map(val => val / randomMagnitude);
    } else {
      normalizedEmbedding = embedding.map(val => val / magnitude);
    }
    
    console.log("Normalized embedding length:", normalizedEmbedding.length);
    console.log("Magnitude:", magnitude);

    // Cache the normalized embedding
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
    
    return fallbackEmbedding;
  }
};

// Calculate cosine similarity between two embeddings
const cosineSimilarity = (vec1, vec2) => {
  if (!Array.isArray(vec1) || !Array.isArray(vec2)) {
    console.error("Invalid vectors for cosine similarity");
    return 0;
  }
  
  if (vec1.length !== vec2.length) {
    console.error("Vector length mismatch:", vec1.length, "vs", vec2.length);
    return 0;
  }
  
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitude1 === 0 || magnitude2 === 0) {
    console.error("Zero magnitude vector detected");
    return 0;
  }
  
  return dotProduct / (magnitude1 * magnitude2);
};

const generateSentenceSimilarityWithHuggingFace = async (sourceSentence, sentences) => {
  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2`,
      {
        inputs: {
          source_sentence: sourceSentence,
          sentences: sentences // array of strings
        },
        options: { wait_for_model: true }
      },
      {
        headers: {
          'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    // The response is an array of similarity scores
    return response.data;
  } catch (error) {
    console.error("Hugging Face API error:", error.response?.data || error.message);
    throw error;
  }
};


module.exports = {
  generateEmbedding,
  cosineSimilarity,
  generateEmbeddingWithOpenAI,
  generateEmbeddingWithHuggingFace,
  generateEmbeddingWithLocalServer,
  generateSentenceSimilarityWithHuggingFace
};