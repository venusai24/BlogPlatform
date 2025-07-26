const redisClient = require('./redisClient');
const summarizeQueue = require('./queue');
const { generateEmbedding, cosineSimilarity } = require('./embeddingService');
const Groq = require("groq-sdk");
const crypto = require("crypto");
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); 
const redisEnabled = true; 

function preprocessText(text) {
    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const uniqueParagraphs = [...new Set(paragraphs)];
    const filtered = uniqueParagraphs.filter(p => !/copyright|footer|all rights reserved/i.test(p));
    return filtered.join('\n').replace(/\s+/g, ' ').trim();
}


async function getSemanticCachedSummary(text, threshold = 0.95) {
    const newEmbedding = await generateEmbedding(text);
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

function adaptiveChunkText(text, maxWords = 200, overlapWords = 20) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/);

    if (words.length <= maxWords) {
      chunks.push(para.trim());
    } else {
      const sentences = para.match(/[^.!?]+[.!?]*/g) || [para];
      let buffer = [];
      let wordCount = 0;

      for (const sentence of sentences) {
        const sentenceWords = sentence.trim().split(/\s+/).length;

        if (wordCount + sentenceWords > maxWords) {
          chunks.push(buffer.join(' ').trim());
          buffer = buffer.slice(-overlapWords); 
          wordCount = buffer.join(' ').split(/\s+/).length;
        }

        buffer.push(sentence);
        wordCount += sentenceWords;
      }

      if (buffer.length > 0) chunks.push(buffer.join(' ').trim());
    }
  }

  return chunks;
}

const summarizeChunk = async (chunk, compressionRatio, model = "llama-3.3-70b-versatile") => {
  const chunkHashKey = generateHashKey("chunk", chunk);

  console.log(`Processing chunk with hash key: ${chunkHashKey}`);
  const wordCount = chunk.split(/\s+/).length;
  console.log(`Word count for chunk: ${wordCount}`);
  const maxTokens = Math.max(Math.floor(wordCount * compressionRatio * 5), 1);
  console.log(`Max tokens calculated: ${maxTokens}`);

  try {
    console.log(`Sending request to Groq API with model: ${model}`);
    const chatCompletion = await groq.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are an assistant that summarizes text." },
        { role: "user", content: `Summarize this text:\n\n${chunk}` },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    console.log(`Groq API response received:`, chatCompletion);
    const summary = chatCompletion.choices[0]?.message?.content?.trim() || "";
    console.log(`Summary generated for chunk: ${summary}`);
    return summary;
  } catch (error) {
    console.error("Error summarizing chunk via Groq API:", error);
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
  console.log(`Processing full text with hash key: ${textHashKey}`);
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
  console.log(`Word limit for model ${model}: ${wordLimit}`);
  const chunks = adaptiveChunkText(text, wordLimit);
  console.log(`Text split into ${chunks.length} chunks`);
  const compressionRatio = calculateCompressionRatio(text);
  console.log(`Compression ratio calculated: ${compressionRatio}`);
  const chunkSummaries = await Promise.all(
    chunks.map((chunk) => summarizeChunk(chunk, compressionRatio, model))
  );
  const combinedSummary = chunkSummaries.filter(Boolean).join(" ");
  console.log(`Combined summary from chunks: ${combinedSummary}`);
  const finalSummary = await summarizeChunk(combinedSummary, 0.3, model);
  const finalResult = finalSummary || combinedSummary;
  console.log(`Final summary generated: ${finalResult}`);
  if (redisEnabled) {
    try {
      await redisClient.set(textHashKey, finalResult, { EX: 86400 });
      console.log(`Final summary cached with key: ${textHashKey}`);
    } catch (error) {
      console.error("Redis error while setting full text:", error);
    }
  }
  return finalResult;
};


async function summarizeJob({ text, model }) {
    console.log("Starting summarizeJob with text length:", text.length, "and model:", model);
    if (Array.isArray(text)) {
        const results = [];
        for (const t of text) {
            console.log("Processing text chunk:", t);
            const preprocessed = preprocessText(t);
            console.log("Preprocessed text:", preprocessed);
            const semanticCached = await getSemanticCachedSummary(preprocessed);
            if (semanticCached) {
                console.log("Cache hit for text chunk:", semanticCached);
                results.push(semanticCached);
                continue;
            }
            const selectedModel = model || selectModel(preprocessed);
            console.log("Selected model for text chunk:", selectedModel);
            const summary = await summarizeText(preprocessed, selectedModel);
            console.log("Generated summary for text chunk:", summary);
            const embedding = await generateEmbedding(preprocessed);
            console.log("Generated embedding for text chunk:", embedding);
            await setSemanticCachedSummary(preprocessed, summary, embedding);
            results.push(summary);
        }
        console.log("SummarizeJob completed with results:", results);
        return results;
    } else {
        console.log("Processing single text input:", text);
        const preprocessed = preprocessText(text);
        console.log("Preprocessed text:", preprocessed);
        const semanticCached = await getSemanticCachedSummary(preprocessed);
        if (semanticCached) {
            console.log("Cache hit for text:", semanticCached);
            return semanticCached;
        }
        const selectedModel = model || selectModel(preprocessed);
        console.log("Selected model for text:", selectedModel);
        const summary = await summarizeText(preprocessed, selectedModel);
        console.log("Generated summary for text:", summary);
        const embedding = await generateEmbedding(preprocessed);
        console.log("Generated embedding for text:", embedding);
        await setSemanticCachedSummary(preprocessed, summary, embedding);
        console.log("SummarizeJob completed with summary:", summary);
        return summary;
    }
}

function selectModel(text) {
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 300) return 'mistral-7b'; 
    if (wordCount < 1000) return 'llama-3-8b';
    return 'llama-3.3-70b-versatile'; 
}

async function queueSummarization(text, model = "llama-3.3-70b-versatile") {
    console.log(`Queueing summarization job with text length: ${text.length}, model: ${model}`);
    try {
        const job = await summarizeQueue.add('summarize', { text, model });
        console.log(`Job successfully queued with ID: ${job.id}`);
        return job.id;
    } catch (error) {
        console.error("Error queueing summarization job:", error);
        throw error;
    }
}

async function getSummarizationStatus(jobId) {
    console.log(`Fetching status for job ID: ${jobId}`);
    try {
        const job = await summarizeQueue.getJob(jobId);
        if (!job) {
            console.log(`Job not found for ID: ${jobId}`);
            return { status: 'not_found' };
        }
        if (job.finishedOn) {
            console.log(`Job completed for ID: ${jobId}, summary: ${job.returnvalue}`);
            return { status: 'completed', summary: job.returnvalue };
        }
        console.log(`Job still pending for ID: ${jobId}`);
        return { status: 'pending' };
    } catch (error) {
        console.error(`Error fetching status for job ID: ${jobId}`, error);
        throw error;
    }
}

async function testGroqConnection() {
    console.log("Testing Groq API connection...");
    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are an assistant that echoes text." },
                { role: "user", content: "Test connection" },
            ],
            max_tokens: 10,
            temperature: 0.7,
        });
        console.log("Groq connection test successful:", response);
    } catch (error) {
        console.error("Groq connection test failed:", error);
    }
}

function increasePollingTimeout() {
    console.log("Increasing polling timeout in frontend...");
    // Example: Adjust timeout logic in frontend
    const newTimeout = 120; // seconds
    console.log(`Polling timeout increased to ${newTimeout} seconds`);
}

// Call the test function
// Uncomment the line below to test the connection
// testGroqConnection();

module.exports = Object.assign(summarizeText, {
    summarizeJob,
    queueSummarization,
    getSummarizationStatus,
    preprocessText,
    getSemanticCachedSummary,
    setSemanticCachedSummary,
    selectModel,
    adaptiveChunkText
});
