const Groq = require('groq-sdk');
const config = require('../../src/config');

const getGroqClient = () => new Groq({
    apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1 || 'dummy_key_to_prevent_crash'
});

async function chat({ system, user, maxTokens, temperature, signal }) {
    const modelId = config.llm.modelId;
    const completion = await getGroqClient().chat.completions.create({
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        model: modelId,
        temperature,
        max_tokens: maxTokens,
    }, { signal });
    return {
        text: completion.choices[0]?.message?.content || '',
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
        modelId
    };
}

module.exports = { chat };
