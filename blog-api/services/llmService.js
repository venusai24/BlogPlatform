const crypto = require('crypto');
const redisClient = require('./redisClient');
const monitoringService = require('./monitoringService');
const config = require('../src/config');
const logger = require('../src/utils/logger');
const { emitMetric } = require('../src/utils/metrics');
const { getChatClient } = require('./llm');

class LlmService {
    async generateRagAnswer(query, snippets, detailLevel = 'brief') {
        const startTime = Date.now();
        let cacheKey = null;
        let timeoutId = null;

        try {
            if (!snippets || snippets.length === 0) {
                return { answer: "I couldn't find any relevant information in the blogs to answer your question.", generationId: null };
            }

            const context = snippets.map((s, i) => `[Source ${i + 1}] Title: ${s.title}\nExcerpt: ${s.snippet}`).join('\n\n');

            let systemPrompt = `You are a STRICT and PRECISE assistant for a Blog Platform.
Your ONLY source of information is the 'Context:' block provided below.
You MUST NOT use any internal knowledge, outside knowledge, or training data to answer the question.
If the answer cannot be explicitly found within the exact words of the provided Context, you MUST respond exactly with: "I cannot answer this based on the available blogs."
DO NOT hallucinate. DO NOT add extra information. Ensure 100% strict faithfulness to the context.`;

            if (detailLevel === 'brief') {
                systemPrompt += `\nCRITICAL INSTRUCTION: Provide a VERY BRIEF answer (2-3 sentences maximum). Keep it concise.`;
            } else {
                systemPrompt += `\nCRITICAL INSTRUCTION: Provide a DETAILED, well-structured answer. Use markdown formatting like bullet points or bold text if it makes the answer clearer. Explain the concepts thoroughly based on the excerpts.`;
            }

            // Generate Cache Key
            const hash = crypto.createHash('sha256');
            hash.update(query + context + detailLevel);
            cacheKey = `rag:${hash.digest('hex')}`;

            // Check Redis Cache
            if (redisClient.isOpen) {
                try {
                    const cachedAnswer = await redisClient.get(cacheKey);
                    if (cachedAnswer) {
                        const parsed = JSON.parse(cachedAnswer);
                        const latency = Date.now() - startTime;
                        
                        const generationId = await monitoringService.logRagGeneration({
                            query,
                            retrievedDocsCount: snippets.length,
                            generationLatencyMs: latency,
                            totalCost: 0, // Cached
                            modelUsed: 'cache',
                            inputTokens: 0,
                            outputTokens: 0,
                            prompt: systemPrompt,
                            answer: parsed.answer
                        });

                        return { answer: parsed.answer, generationId };
                    }
                } catch (e) {
                    logger.warn({ err: e }, 'Redis cache error');
                }
            }

            // API Call with p99 timeout (e.g., 3000ms for LLaMA 3.1 8b instant)
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second strict timeout

            const completion = await getChatClient().chat({
                system: systemPrompt,
                user: `Context:\n${context}\n\nUser Question: ${query}`,
                maxTokens: detailLevel === 'brief' ? 150 : 800,
                temperature: 0.2,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const modelName = config.llm.modelId;
            const answer = completion.text || "Sorry, I couldn't generate an answer.";
            const latency = Date.now() - startTime;
            emitMetric('LlmLatencyMs', latency, 'Milliseconds');

            // Cost from the configured per-million-token prices (LLM_PRICE_IN_PER_MTOK / LLM_PRICE_OUT_PER_MTOK)
            const { inputTokens, outputTokens } = completion;
            const totalCost = (inputTokens * config.llm.priceInPerMTok / 1e6)
                + (outputTokens * config.llm.priceOutPerMTok / 1e6);

            // Log Telemetry
            const generationId = await monitoringService.logRagGeneration({
                query,
                retrievedDocsCount: snippets.length,
                generationLatencyMs: latency,
                totalCost,
                modelUsed: modelName,
                inputTokens,
                outputTokens,
                prompt: systemPrompt,
                answer
            });

            // Set Cache
            if (redisClient.isOpen) {
                try {
                    await redisClient.set(cacheKey, JSON.stringify({ answer }), { EX: 3600 }); // Cache for 1 hour
                } catch(e) {
                    logger.warn({ err: e }, 'Redis set error');
                }
            }

            return { answer, generationId };

        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            const latency = Date.now() - startTime;
            
            logger.error({ err: error }, 'Error generating RAG answer');
            emitMetric('LlmFallback', 1);

            // Graceful Degradation
            const fallbackAnswer = "I'm currently experiencing high latency. Here are the snippets I found that might help:\n\n" + 
                snippets.map(s => `- **${s.title}**: ${s.snippet}`).join('\n');
            
            const generationId = await monitoringService.logRagGeneration({
                query,
                retrievedDocsCount: snippets?.length || 0,
                generationLatencyMs: latency,
                totalCost: 0,
                modelUsed: 'fallback_error',
                inputTokens: 0,
                outputTokens: 0,
                prompt: 'N/A',
                answer: fallbackAnswer,
                error: error.message
            });

            return { answer: fallbackAnswer, generationId };
        }
    }

    async transformQuery(query) {
        let timeoutId = null;
        try {
            const systemPrompt = `You are an expert search engine query optimizer for a Blog Platform.
Given the user's short or vague query, rewrite it to be a highly effective search query. Then, provide a brief hypothetical paragraph (HyDE) that directly answers the query. This hallucinated answer will be used to find semantically similar real blog posts.
Output ONLY the rewritten query and hypothetical answer as a single string of text, no markdown formatting or intro text.`;

            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for query rewrite

            const completion = await getChatClient().chat({
                system: systemPrompt,
                user: query,
                maxTokens: 150,
                temperature: 0.3,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            return completion.text || query;
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            logger.warn({ err: error }, 'Error transforming query');
            return query; // fallback to original query
        }
    }
}

module.exports = new LlmService();
