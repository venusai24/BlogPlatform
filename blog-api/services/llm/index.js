const config = require('../../src/config');
const { maybeFail } = require('../../src/utils/faults');
const bedrockChat = require('./bedrockChat');
const groqChat = require('./groqChat');

// Returns the chat client for config.llm.provider. Interface:
//   chat({ system, user, maxTokens, temperature, signal }) -> Promise<{ text, inputTokens, outputTokens, modelId }>
// Every call goes through the fault-injection hook (a no-op unless FAULT_LLM_ERROR_RATE is set).
function getChatClient() {
    const client = config.llm.provider === 'bedrock' ? bedrockChat : groqChat;
    return {
        chat: async (args) => {
            maybeFail('llm');
            return client.chat(args);
        }
    };
}

module.exports = { getChatClient };
