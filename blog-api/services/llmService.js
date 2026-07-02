const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

class LlmService {
    async generateRagAnswer(query, snippets, detailLevel = 'brief') {
        try {
            if (!snippets || snippets.length === 0) {
                return "I couldn't find any relevant information in the blogs to answer your question.";
            }

            const context = snippets.map((s, i) => `[Source ${i + 1}] Title: ${s.title}\nExcerpt: ${s.snippet}`).join('\n\n');

            let systemPrompt = `You are a helpful and knowledgeable assistant for a Blog Platform.
Your task is to answer the user's question using ONLY the provided excerpts from our blogs.
If the excerpts do not contain the answer, politely state that you cannot answer based on the available blogs.
Do NOT use outside knowledge. Cite your sources informally if helpful.`;

            if (detailLevel === 'brief') {
                systemPrompt += `\nCRITICAL INSTRUCTION: Provide a VERY BRIEF answer (2-3 sentences maximum). Keep it concise.`;
            } else {
                systemPrompt += `\nCRITICAL INSTRUCTION: Provide a DETAILED, well-structured answer. Use markdown formatting like bullet points or bold text if it makes the answer clearer. Explain the concepts thoroughly based on the excerpts.`;
            }

            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: `Context:\n${context}\n\nUser Question: ${query}`
                    }
                ],
                model: 'llama-3.1-8b-instant',
                temperature: 0.2,
                max_tokens: detailLevel === 'brief' ? 150 : 800,
            });

            return chatCompletion.choices[0]?.message?.content || "Sorry, I couldn't generate an answer.";
        } catch (error) {
            console.error('Error generating RAG answer with Groq:', error);
            throw new Error('Failed to generate answer from LLM.');
        }
    }
}

module.exports = new LlmService();
