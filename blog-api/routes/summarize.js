const Groq = require("groq-sdk");
const redis = require("redis");
const crypto = require("crypto");

const groq = new Groq({ apiKey: "your_groq_api_key" }); // Please replace with your GROQ API key.

let redisClient;
let redisEnabled = true;

(async () => {
  try {
    redisClient = redis.createClient();
    await redisClient.connect();
    console.log("Connected to Redis server.");
  } catch (error) {
    console.error("Failed to connect to Redis server. Redis functionality will be disabled.", error);
    redisEnabled = false;
  }
})();

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

const summarizeChunk = async (chunk, compressionRatio, model = "llama-3.3-70b-versatile") => {
  const chunkHashKey = generateHashKey("chunk", chunk);

  if (redisEnabled) {
    try {
      const cachedSummary = await redisClient.get(chunkHashKey);
      if (cachedSummary) {
        console.log(`Cache hit for chunk: ${chunkHashKey}`);
        return cachedSummary;
      }
    } catch (error) {
      console.error("Redis error while fetching chunk:", error);
    }
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

    if (redisEnabled) {
      try {
        await redisClient.set(chunkHashKey, summary, { EX: 86400 });
      } catch (error) {
        console.error("Redis error while setting chunk:", error);
      }
    }

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
  const chunks = chunkTextWithParagraphs(text, wordLimit);

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

module.exports = summarizeText;
