const mongoose = require('mongoose');
const Groq = require('groq-sdk');
require('dotenv').config();

const BlogContent = require('../model/BlogContent');
const semanticSearchService = require('../services/semanticSearchService');
const llmService = require('../services/llmService');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateSyntheticDataset(numSamples = 5) {
    console.log('--- Generating Synthetic Dataset ---');
    const blogs = await BlogContent.find().limit(numSamples);
    const dataset = [];

    for (const blog of blogs) {
        const prompt = `Based on the following blog post, generate one specific question that can be answered using this text, and provide the exact answer based ONLY on the text. Return in JSON format: {"query": "...", "expectedAnswer": "..."} \n\nBlog Title: ${blog.title}\nContent: ${blog.content.substring(0, 1000)}`;
        
        try {
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama-3.1-8b-instant',
                response_format: { type: 'json_object' }
            });
            
            const result = JSON.parse(completion.choices[0].message.content);
            dataset.push({
                query: result.query,
                expectedAnswer: result.expectedAnswer,
                blogId: blog._id.toString()
            });
        } catch (e) {
            console.error('Failed to generate synthetic pair for blog', blog._id, e);
        }
    }
    console.log(`Generated ${dataset.length} QA pairs.`);
    return dataset;
}

async function evaluateRetrieval(dataset) {
    console.log('--- Evaluating Retrieval ---');
    let mrrSum = 0;
    let hitsAt5 = 0;
    
    for (const data of dataset) {
        const results = await semanticSearchService.searchBlogs(data.query, { limit: 5 });
        const rank = results.findIndex(r => r.id === data.blogId) + 1;
        
        if (rank > 0) {
            mrrSum += (1 / rank);
            if (rank <= 5) hitsAt5++;
        }
    }
    
    const mrr = mrrSum / dataset.length;
    const recallAt5 = hitsAt5 / dataset.length;
    
    console.log(`MRR: ${mrr.toFixed(2)}`);
    console.log(`Recall@5: ${(recallAt5 * 100).toFixed(2)}%`);
    return { mrr, recallAt5 };
}

async function evaluateGeneration(dataset) {
    console.log('--- Evaluating Generation (LLM-as-a-judge) ---');
    let faithfulnessScores = 0;
    let relevanceScores = 0;

    for (const data of dataset) {
        // Retrieve and generate
        const searchResults = await semanticSearchService.searchBlogs(data.query, { limit: 3 });
        const snippets = searchResults.map(r => ({ title: r.title, snippet: r.snippet }));
        const ragResponse = await llmService.generateRagAnswer(data.query, snippets, 'detailed');
        const answer = ragResponse.answer;
        
        const contextText = snippets.map(s => s.snippet).join('\n');

        // Evaluate Faithfulness
        const faithfulnessPrompt = `Evaluate if the following answer is strictly derived from the context. It must not contain outside information (contamination). Answer with a score of 1 (faithful) or 0 (hallucinated/unfaithful). Return JSON: {"score": 1 or 0, "reason": "..."}
        
Context: ${contextText}
Answer: ${answer}`;

        // Evaluate Relevance
        const relevancePrompt = `Evaluate if the following answer directly answers the query. Answer with a score of 1 (relevant) or 0 (irrelevant). Return JSON: {"score": 1 or 0, "reason": "..."}
        
Query: ${data.query}
Answer: ${answer}`;

        try {
            const [faithRes, relRes] = await Promise.all([
                groq.chat.completions.create({
                    messages: [{ role: 'user', content: faithfulnessPrompt }],
                    model: 'llama-3.1-8b-instant',
                    response_format: { type: 'json_object' }
                }),
                groq.chat.completions.create({
                    messages: [{ role: 'user', content: relevancePrompt }],
                    model: 'llama-3.1-8b-instant',
                    response_format: { type: 'json_object' }
                })
            ]);

            const faithData = JSON.parse(faithRes.choices[0].message.content);
            const relData = JSON.parse(relRes.choices[0].message.content);
            
            faithfulnessScores += faithData.score;
            relevanceScores += relData.score;
            
        } catch (e) {
            console.error('Evaluation generation failed for query:', data.query, e);
        }
    }

    const avgFaithfulness = faithfulnessScores / dataset.length;
    const avgRelevance = relevanceScores / dataset.length;

    console.log(`Faithfulness: ${(avgFaithfulness * 100).toFixed(2)}%`);
    console.log(`Answer Relevance: ${(avgRelevance * 100).toFixed(2)}%`);
    return { avgFaithfulness, avgRelevance };
}

async function runBenchmark() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/blogplatform');
        console.log('Connected to MongoDB');
        
        const dataset = await generateSyntheticDataset(5); // Adjust sample size as needed
        if (dataset.length === 0) {
            console.log('No data to evaluate. Please ensure you have blogs in the DB.');
            process.exit(1);
        }

        await evaluateRetrieval(dataset);
        await evaluateGeneration(dataset);

        console.log('--- Benchmarking Complete ---');
        process.exit(0);
    } catch (error) {
        console.error('Benchmarking failed:', error);
        process.exit(1);
    }
}

runBenchmark();
