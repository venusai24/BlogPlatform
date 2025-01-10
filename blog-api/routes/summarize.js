const Groq = require("groq-sdk");


const groq = new Groq({ apiKey: "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" });

// Helper function to estimate token count
const estimateTokens = (text) => Math.ceil(text.length / 4); // Approximation: 4 characters per token

// Get ideal word limit based on the model's maximum token capacity
const getWordLimit = (model) => {
  const maxTokens = model === "llama-3.3-70b-versatile" ? 130000 : 4096; // Adjust for different models
  return Math.floor((maxTokens / 1.33) / 1.75); // Tokens to words conversion
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

    // If adding this paragraph exceeds the limit, finalize the current chunk
    if (currentWordCount + paragraphWordCount > maxWords) {
      chunks.push(currentChunk.join("\n"));
      currentChunk = [paragraph];
      currentWordCount = paragraphWordCount;
    } else {
      currentChunk.push(paragraph);
      currentWordCount += paragraphWordCount;
    }
  });

  // Add the last chunk if it exists
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
};

// Function to summarize a single chunk using Groq
const summarizeChunk = async (chunk, compressionRatio, model = "llama-3.3-70b-versatile") => {
    const wordCount = chunk.split(/\s+/).length;
    const maxTokens = Math.max(Math.floor(wordCount * compressionRatio * 5), 1); // Ensure max_tokens is positive
  
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
  
      return chatCompletion.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error("Error summarizing chunk:", error);
      return null;
    }
  };
  

const calculateCompressionRatio = (text) => {
  const wordCount = text.split(/\s+/).length;
  const redundancyScore = Math.min(Math.max(wordCount / 1000, 0), 1); // Arbitrary scoring for redundancy

  // Determine compression ratio: more redundant = lower compression ratio
  if (redundancyScore > 0.7) {
    return 0.15; // High redundancy, compress to 15%
  } else if (redundancyScore > 0.3) {
    return 0.2; // Medium redundancy, compress to 20%
  } else {
    return 0.3; // Low redundancy, compress to 30%
  }
};

// Main function to summarize text using Groq
const summarizeText = async (text, model = "llama-3.3-70b-versatile") => {
  const wordLimit = getWordLimit(model); // Get dynamic word limit based on model
  console.log(`Ideal word limit per chunk for ${model}: ${wordLimit}`);

  const chunks = chunkTextWithParagraphs(text, wordLimit);
  console.log(`Text split into ${chunks.length} chunks.`);

  const compressionRatio = calculateCompressionRatio(text);
  console.log(`Compression ratio selected: ${compressionRatio * 100}%`);

  // Summarize each chunk
  const chunkSummaries = await Promise.all(
    chunks.map((chunk) => summarizeChunk(chunk, compressionRatio, model))
  );

  // Combine summaries
  const combinedSummary = chunkSummaries.filter(Boolean).join(" ");

  // Resummarize the combined summary for brevity if needed
  const finalSummary = await summarizeChunk(combinedSummary, 0.3, model);

  return finalSummary || combinedSummary;
};






module.exports = summarizeText;