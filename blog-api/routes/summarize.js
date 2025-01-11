const Groq = require("groq-sdk");
const redis = require("redis");
const crypto = require("crypto");

const groq = new Groq({ apiKey: "your_groq_api_key" });

// Redis client setup
const redisClient = redis.createClient();
redisClient.connect();

// Helper function to create a hash key for caching
const generateHashKey = (prefix, content) =>
  `${prefix}:${crypto.createHash("sha256").update(content).digest("hex")}`;

// Helper function to estimate token count
const estimateTokens = (text) => Math.ceil(text.length / 4);

// Get ideal word limit based on the model's maximum token capacity
const getWordLimit = (model) => {
  const maxTokens = model === "llama-3.3-70b-versatile" ? 130000 : 4096;
  return Math.floor((maxTokens / 1.33) / 1.75);
};

// Helper function to split text into paragraphs
const splitByParagraphs = (text) => text.split(/\n+/).filter((p) => p.trim() !== "");

// Helper function to chunk text with paragraph boundaries
const chunkTextWithParagraphs = (text, maxWords) => {
  const paragraphs = splitByParagraphs(text);
  const chunks = [];
  let currentChunk = [];
  let currentWordCount = 0;

  paragraphs.forEach((paragraph) => {
    const paragraphWordCount = paragraph.split(/\s+/).length;

    if (currentWordCount + paragraphWordCount > maxWords) {
      chunks.push(currentChunk.join("\n"));
      currentChunk = [paragraph];
      currentWordCount = paragraphWordCount;
    } else {
      currentChunk.push(paragraph);
      currentWordCount += paragraphWordCount;
    }
  });

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
};

// Function to summarize a single chunk using Groq with caching
const summarizeChunk = async (chunk, compressionRatio, model = "llama-3.3-70b-versatile") => {
  const chunkHashKey = generateHashKey("chunk", chunk);

  // Check cache for existing summary
  const cachedSummary = await redisClient.get(chunkHashKey);
  if (cachedSummary) {
    console.log(`Cache hit for chunk: ${chunkHashKey}`);
    return cachedSummary;
  }

  console.log(`Cache miss for chunk: ${chunkHashKey}`);
  const wordCount = chunk.split(/\s+/).length;
  const maxTokens = Math.max(Math.floor(wordCount * compressionRatio * 5), 1);

  try {
    const chatCompletion = await groq.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are an assistant that summarizes text." },
        { role: "user", content: `Summarize this text:\n\n${chunk}` },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    const summary = chatCompletion.choices[0]?.message?.content?.trim() || "";

    // Cache the result with a TTL (e.g., 24 hours)
    await redisClient.set(chunkHashKey, summary, { EX: 86400 });

    return summary;
  } catch (error) {
    console.error("Error summarizing chunk:", error);
    return null;
  }
};

// Function to calculate compression ratio
const calculateCompressionRatio = (text) => {
  const wordCount = text.split(/\s+/).length;
  const redundancyScore = Math.min(Math.max(wordCount / 1000, 0), 1);

  if (redundancyScore > 0.7) {
    return 0.15;
  } else if (redundancyScore > 0.3) {
    return 0.2;
  } else {
    return 0.3;
  }
};

// Main function to summarize text with caching
const summarizeText = async (text, model = "llama-3.3-70b-versatile") => {
  const textHashKey = generateHashKey("full-text", text);

  // Check full-text cache
  const cachedSummary = await redisClient.get(textHashKey);
  if (cachedSummary) {
    console.log(`Cache hit for full text: ${textHashKey}`);
    return cachedSummary;
  }

  console.log(`Cache miss for full text: ${textHashKey}`);
  const wordLimit = getWordLimit(model);
  const chunks = chunkTextWithParagraphs(text, wordLimit);

  const compressionRatio = calculateCompressionRatio(text);

  // Summarize each chunk and combine results
  const chunkSummaries = await Promise.all(
    chunks.map((chunk) => summarizeChunk(chunk, compressionRatio, model))
  );
  const combinedSummary = chunkSummaries.filter(Boolean).join(" ");

  // Final re-summarization for brevity
  const finalSummary = await summarizeChunk(combinedSummary, 0.3, model);

  const finalResult = finalSummary || combinedSummary;

  // Cache the full-text result
  await redisClient.set(textHashKey, finalResult, { EX: 86400 });

  return finalResult;
};

module.exports = summarizeText;
