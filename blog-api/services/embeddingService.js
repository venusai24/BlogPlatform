const config = require('../src/config');
const logger = require('../src/utils/logger');
const { maybeFail } = require('../src/utils/faults');
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { InferenceClient } = require("@huggingface/inference");
const axios = require('axios');

const bedrockClient = new BedrockRuntimeClient({ region: config.awsRegion });

async function embed(texts) {
    maybeFail('embed'); // resilience experiments; a no-op unless configured
    if (!Array.isArray(texts) || texts.length === 0) {
        return [];
    }

    const provider = config.embedding.provider;
    const modelId = config.embedding.modelId;
    const dim = config.embedding.dim;

    if (provider === 'local') {
        const LOCAL_SERVER_URL = process.env.EMBEDDING_SERVER_URL || 'http://localhost:8000';
        const embeddings = [];
        for (const text of texts) {
            try {
                const response = await axios.post(`${LOCAL_SERVER_URL}/embed`, { text }, { timeout: 30000 });
                embeddings.push(response.data.embedding);
            } catch (err) {
                logger.error({ err, text: text.substring(0, 50) }, "Local embedding error");
                throw err;
            }
        }
        return embeddings;
    } else if (provider === 'huggingface') {
        const hfKeys = [process.env.HUGGINGFACE_API_KEY_1, process.env.HUGGINGFACE_API_KEY_2].filter(Boolean);
        if (hfKeys.length === 0) throw new Error("Missing HUGGINGFACE_API_KEYs");

        let lastErr = null;
        for (const key of hfKeys) {
            try {
                const client = new InferenceClient(key);
                const response = await client.featureExtraction({
                    model: modelId || "sentence-transformers/all-MiniLM-L6-v2",
                    inputs: texts,
                    provider: "hf-inference",
                });
                
                if (texts.length === 1 && !Array.isArray(response[0])) {
                    return [response];
                }
                return response;
            } catch (err) {
                logger.error({ err }, "HuggingFace embedding error with a key, trying next...");
                lastErr = err;
            }
        }
        throw lastErr;
    } else if (provider === 'bedrock') {
        const embeddings = [];
        for (const text of texts) {
            try {
                const payload = {
                    inputText: text,
                    dimensions: dim,
                    normalize: true
                };
                const command = new InvokeModelCommand({
                    modelId: modelId,
                    contentType: "application/json",
                    accept: "application/json",
                    body: JSON.stringify(payload)
                });
                const response = await bedrockClient.send(command);
                const body = JSON.parse(new TextDecoder().decode(response.body));
                embeddings.push(body.embedding);
            } catch (err) {
                logger.error({ err, text: text.substring(0, 50) }, "Bedrock embedding error");
                throw err;
            }
        }
        return embeddings;
    } else {
        throw new Error(`Unsupported embedding provider: ${provider}`);
    }
}

// Keep the old single-text function for compatibility during migration, but wrap it
const generateEmbedding = async (text) => {
    const res = await embed([text]);
    return res[0];
};

const cosineSimilarity = (vec1, vec2) => {
    if (!Array.isArray(vec1) || !Array.isArray(vec2)) return 0;
    if (vec1.length !== vec2.length) return 0;
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    return dotProduct / (magnitude1 * magnitude2);
};

const generateSentenceSimilarityWithHuggingFace = async (sourceSentence, sentences) => {
    try {
        const hfKeys = [process.env.HUGGINGFACE_API_KEY_1, process.env.HUGGINGFACE_API_KEY_2].filter(Boolean);
        if (hfKeys.length > 0) {
            let lastErr = null;
            for (const key of hfKeys) {
                try {
                    const client = new InferenceClient(key);
                    return await client.sentenceSimilarity({
                        model: "sentence-transformers/all-MiniLM-L6-v2",
                        inputs: { source_sentence: sourceSentence, sentences },
                        provider: "hf-inference",
                    });
                } catch (e) {
                    lastErr = e;
                }
            }
            throw lastErr;
        }
        throw new Error("No HuggingFace API key");
    } catch (e) {
        logger.warn({err: e}, "Falling back to local cosine similarity");
        const sourceEmb = await generateEmbedding(sourceSentence);
        const scores = [];
        for (const sentence of sentences) {
            if (!sentence) {
                scores.push(0);
                continue;
            }
            const targetEmb = await generateEmbedding(sentence);
            scores.push(cosineSimilarity(sourceEmb, targetEmb));
        }
        return scores;
    }
}

module.exports = {
    embed,
    generateEmbedding,
    cosineSimilarity,
    generateSentenceSimilarityWithHuggingFace
};