const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const config = require('../../src/config');

let client = null;
const getClient = () => {
    if (!client) client = new BedrockRuntimeClient({ region: config.awsRegion });
    return client;
};

// gpt-oss responses can start with a reasoningContent block, so content[0] is not always the answer.
// Take every block that carries a string `text` and join them.
function extractConverseText(response) {
    const blocks = response?.output?.message?.content || [];
    return blocks.filter(block => typeof block.text === 'string').map(block => block.text).join('');
}

async function chat({ system, user, maxTokens, temperature, signal }) {
    const modelId = config.llm.modelId;
    const command = new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        inferenceConfig: { maxTokens, temperature }
    });
    const response = await getClient().send(command, signal ? { abortSignal: signal } : undefined);
    return {
        text: extractConverseText(response),
        inputTokens: response.usage?.inputTokens || 0,
        outputTokens: response.usage?.outputTokens || 0,
        modelId
    };
}

module.exports = { chat, extractConverseText };
