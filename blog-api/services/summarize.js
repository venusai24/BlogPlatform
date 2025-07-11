const redisClient = require('./redisClient');
const summarizeQueue = require('./queue');
const { generateEmbedding, cosineSimilarity } = require('./embeddingService');
const Groq = require("groq-sdk");
const crypto = require("crypto");
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); 
const redisEnabled = true; // or set based on your config if needed

// Preprocess text: remove boilerplate, deduplicate, normalize whitespace
function preprocessText(text) {
    // Remove repeated paragraphs
    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const uniqueParagraphs = [...new Set(paragraphs)];
    // Remove boilerplate (customize as needed)
    const filtered = uniqueParagraphs.filter(p => !/copyright|footer|all rights reserved/i.test(p));
    // Normalize whitespace
    return filtered.join('\n').replace(/\s+/g, ' ').trim();
}

// Semantic cache lookup
async function getSemanticCachedSummary(text, threshold = 0.95) {
    const newEmbedding = await generateEmbedding(text);
    // Scan Redis for all summary embeddings (for demo, use a fixed set or store keys in a set)
    const keys = await redisClient.keys('summary-embedding:*');
    for (const key of keys) {
        const cached = await redisClient.get(key);
        if (cached) {
            const { embedding, summary } = JSON.parse(cached);
            if (cosineSimilarity(newEmbedding, embedding) > threshold) {
                return summary;
            }
        }
    }
    return null;
}

// Store semantic cache
async function setSemanticCachedSummary(text, summary, embedding) {
    const key = `summary-embedding:${crypto.createHash('sha256').update(text).digest('hex')}`;
    await redisClient.set(key, JSON.stringify({ embedding, summary }), { EX: 86400 });
}

const generateHashKey = (prefix, content) =>
  `${prefix}:${crypto.createHash("sha256").update(content).digest("hex")}`;

const estimateTokens = (text) => Math.ceil(text.length / 4);

const getWordLimit = (model) => {
  const maxTokens = model === "llama-3.3-70b-versatile" ? 130000 : 4096;
  return Math.floor((maxTokens / 1.33) / 1.75);
};

const splitByParagraphs = (text) => text.split(/\n+/).filter((p) => p.trim() !== "");

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

// Improved: Adaptive chunking using sentence boundaries
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

const summarizeChunk = async (chunk, compressionRatio, model = "llama-3.3-70b-versatile") => {
  const chunkHashKey = generateHashKey("chunk", chunk);

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

    return summary;
  } catch (error) {
    console.error("Error summarizing chunk:", error);
    return null;
  }
};

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

const summarizeText = async (text, model = "llama-3.3-70b-versatile") => {
  const textHashKey = generateHashKey("full-text", text);
  if (redisEnabled) {
    try {
      const cachedSummary = await redisClient.get(textHashKey);
      if (cachedSummary) {
        console.log(`Cache hit for full text: ${textHashKey}`);
        return cachedSummary;
      }
    } catch (error) {
      console.error("Redis error while fetching full text:", error);
    }
  }
  console.log(`Cache miss for full text: ${textHashKey}`);
  const wordLimit = getWordLimit(model);
  const chunks = adaptiveChunkText(text, wordLimit);
  const compressionRatio = calculateCompressionRatio(text);
  const chunkSummaries = await Promise.all(
    chunks.map((chunk) => summarizeChunk(chunk, compressionRatio, model))
  );
  const combinedSummary = chunkSummaries.filter(Boolean).join(" ");
  const finalSummary = await summarizeChunk(combinedSummary, 0.3, model);
  const finalResult = finalSummary || combinedSummary;
  if (redisEnabled) {
    try {
      await redisClient.set(textHashKey, finalResult, { EX: 86400 });
    } catch (error) {
      console.error("Redis error while setting full text:", error);
    }
  }
  return finalResult;
};

// Main summarization function (async job)
// Add batch support to summarizeJob
async function summarizeJob({ text, model }) {
    if (Array.isArray(text)) {
        // Batch mode: summarize each item
        const results = [];
        for (const t of text) {
            const preprocessed = preprocessText(t);
            const semanticCached = await getSemanticCachedSummary(preprocessed);
            if (semanticCached) {
                results.push(semanticCached);
                continue;
            }
            const selectedModel = model || selectModel(preprocessed);
            const summary = await summarizeText(preprocessed, selectedModel);
            const embedding = await generateEmbedding(preprocessed);
            await setSemanticCachedSummary(preprocessed, summary, embedding);
            results.push(summary);
        }
        return results;
    } else {
        // Single text
        const preprocessed = preprocessText(text);
        const semanticCached = await getSemanticCachedSummary(preprocessed);
        if (semanticCached) return semanticCached;
        const selectedModel = model || selectModel(preprocessed);
        const summary = await summarizeText(preprocessed, selectedModel);
        const embedding = await generateEmbedding(preprocessed);
        await setSemanticCachedSummary(preprocessed, summary, embedding);
        return summary;
    }
}

// Model selection based on text length
function selectModel(text) {
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 300) return 'mistral-7b'; // Example: use lighter model for short text
    if (wordCount < 1000) return 'llama-3-8b';
    return 'llama-3.3-70b-versatile'; // Default heavy model
}

// Add job to queue
async function queueSummarization(text, model = "llama-3.3-70b-versatile") {
    const job = await summarizeQueue.add('summarize', { text, model });
    return job.id;
}

// Get job status/result
async function getSummarizationStatus(jobId) {
    const job = await summarizeQueue.getJob(jobId);
    if (!job) return { status: 'not_found' };
    if (job.finishedOn) {
        return { status: 'completed', summary: job.returnvalue };
    }
    return { status: 'pending' };
}

module.exports = Object.assign(summarizeText, {
    summarizeJob,
    queueSummarization,
    getSummarizationStatus,
    preprocessText,
    getSemanticCachedSummary,
    setSemanticCachedSummary,
    selectModel
});
