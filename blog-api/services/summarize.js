const redisClient = require('./redisClient');
const summarizeQueue = require('./queue');
const crypto = require("crypto");
const config = require('../src/config');
const logger = require('../src/utils/logger');
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
const Groq = require("groq-sdk");
const { extractConverseText } = require('./llm/bedrockChat');

const bedrockClient = new BedrockRuntimeClient({ region: config.awsRegion });
let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function preprocessText(text) {
    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const uniqueParagraphs = [...new Set(paragraphs)];
    const filtered = uniqueParagraphs.filter(p => !/copyright|footer|all rights reserved/i.test(p));
    return filtered.join('\n').replace(/\s+/g, ' ').trim();
}

const generateHashKey = (prefix, content) =>
  `${prefix}:${crypto.createHash("sha256").update(content).digest("hex")}`;

const summarizeChunkWithProvider = async (chunk, maxTokens) => {
    const provider = config.summary.provider;
    const modelId = config.summary.modelId;

    if (provider === 'bedrock') {
        const command = new ConverseCommand({
            modelId,
            messages: [{
                role: "user",
                content: [{ text: `Summarize this text:\n\n${chunk}` }]
            }],
            system: [{ text: "You are an assistant that summarizes text." }],
            inferenceConfig: {
                maxTokens: maxTokens,
                temperature: 0.7
            }
        });
        const response = await bedrockClient.send(command);
        return extractConverseText(response).trim();
    } else if (provider === 'groq') {
        if (!groq) throw new Error("GROQ_API_KEY not set");
        const chatCompletion = await groq.chat.completions.create({
            model: modelId || "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are an assistant that summarizes text." },
                { role: "user", content: `Summarize this text:\n\n${chunk}` },
            ],
            max_tokens: maxTokens,
            temperature: 0.7,
        });
        return chatCompletion.choices[0]?.message?.content?.trim() || "";
    } else {
        throw new Error(`Unsupported summary provider: ${provider}`);
    }
};

const summarizeChunk = async (chunk, compressionRatio) => {
    const wordCount = chunk.split(/\s+/).length;
    const maxTokens = Math.max(Math.floor(wordCount * compressionRatio * 5), 1);
    try {
        return await summarizeChunkWithProvider(chunk, maxTokens);
    } catch (error) {
        logger.error({ err: error }, "Error summarizing chunk");
        throw error;
    }
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

const calculateCompressionRatio = (text) => {
  const wordCount = text.split(/\s+/).length;
  const redundancyScore = Math.min(Math.max(wordCount / 1000, 0), 1);
  if (redundancyScore > 0.7) return 0.15;
  if (redundancyScore > 0.3) return 0.2;
  return 0.3;
};

const summarizeText = async (text) => {
  const textHashKey = generateHashKey("full-text", text);
  try {
      const cachedSummary = await redisClient.get(textHashKey);
      if (cachedSummary) return cachedSummary;
  } catch (error) {}

  const chunks = adaptiveChunkText(text, 1000); // 1000 words limit
  const compressionRatio = calculateCompressionRatio(text);
  const chunkSummaries = await Promise.all(
    chunks.map((chunk) => summarizeChunk(chunk, compressionRatio))
  );
  const combinedSummary = chunkSummaries.filter(Boolean).join(" ");
  const finalSummary = await summarizeChunk(combinedSummary, 0.3);
  const finalResult = finalSummary || combinedSummary;

  if (!finalResult || finalResult.trim() === "") {
    throw new Error("Summarization yielded an empty result");
  }
  try {
      await redisClient.set(textHashKey, finalResult, { EX: 86400 });
  } catch (error) {}
  return finalResult;
};


async function summarizeJob({ text }) {
    // The exact-hash cache inside summarizeText is the only cache.
    if (Array.isArray(text)) {
        const results = [];
        for (const t of text) {
            results.push(await summarizeText(preprocessText(t)));
        }
        return results;
    }
    return summarizeText(preprocessText(text));
}

async function queueSummarization(text) {
    try {
        const job = await summarizeQueue.add('summarize', { text });
        return job.id;
    } catch (error) {
        logger.error({ err: error }, "Error queueing summarization job");
        throw error;
    }
}

async function getSummarizationStatus(jobId) {
    try {
        const job = await summarizeQueue.getJob(jobId);
        if (!job) return { status: 'not_found' };
        if (job.failedReason) return { status: 'failed', error: job.failedReason };
        if (job.finishedOn) return { status: 'completed', summary: job.returnvalue };
        return { status: 'pending' };
    } catch (error) {
        throw error;
    }
}

module.exports = Object.assign(summarizeText, {
    summarizeJob,
    queueSummarization,
    getSummarizationStatus,
    preprocessText,
    adaptiveChunkText
});
