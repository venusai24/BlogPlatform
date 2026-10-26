const mongoose = require('mongoose');
const Groq = require('groq-sdk');
require('dotenv').config({ path: '../.env' });

process.env.HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY_2;
const BlogContent = require('../model/BlogContent');
const semanticSearchService = require('../services/semanticSearchService');
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY_1;
const llmService = require('../services/llmService');

const MODEL = 'openai/gpt-oss-20b';

const groqKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3
].filter(Boolean);

let keyIndex = 0;
function getGroqClient() {
    const key = groqKeys[keyIndex % groqKeys.length];
    keyIndex++;
    return new Groq({ apiKey: key });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function sanitize(text, maxLen = 500) {
    if (!text) return '';
    return text.replace(/[^\x20-\x7E\n]/g, ' ').substring(0, maxLen);
}

function parseBinaryScore(raw) {
    const lower = (raw || '').toLowerCase().trim();
    if (lower.startsWith('1') || /\b1\b/.test(lower)) return 1;
    return 0;
}

async function callWithRetry(fn, maxRetries = 4) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            if (e.status === 429) {
                const wait = Math.pow(2, attempt + 1) * 2000;
                console.warn(`\n  [429] Rate limit. Waiting ${wait}ms...`);
                await sleep(wait);
            } else if (e.status === 401) {
                console.warn(`\n  [401] Auth error, rotating key...`);
            } else {
                throw e;
            }
            if (attempt === maxRetries - 1) throw e;
        }
    }
}

// ── Dataset Generation (plain Q&A format, no JSON mode) ───────────────
async function generateSyntheticDataset(numSamples) {
    console.log('--- Generating Synthetic Dataset ---');
    const total = await BlogContent.countDocuments();
    const blogs = await BlogContent.aggregate([{ $sample: { size: Math.min(numSamples * 2, total) } }]);
    const dataset = [];

    for (let i = 0; i < blogs.length && dataset.length < numSamples; i++) {
        const blog = blogs[i];
        const title   = sanitize(blog.title, 150);
        const content = sanitize(blog.content, 600);
        const prompt  = `Blog Title: ${title}\nContent: ${content}\n\nWrite ONE question answerable from this blog, then its answer.\nQuestion: \nAnswer: `;
        try {
            const raw = await callWithRetry(async () => {
                const groq = getGroqClient();
                const c = await groq.chat.completions.create({
                    messages: [{ role: 'user', content: prompt }],
                    model: MODEL,
                    max_tokens: 800,
                    temperature: 0.2
                });
                return c.choices[0].message.content || '';
            });

            // Parse "Question: ...\nAnswer: ..." format
            const qMatch = raw.match(/Question:\s*(.+?)(?:\n|$)/i);
            const aMatch = raw.match(/Answer:\s*([\s\S]+)/i);
            if (qMatch && aMatch) {
                dataset.push({
                    query: qMatch[1].trim(),
                    expectedAnswer: aMatch[1].trim().substring(0, 300),
                    blogId: blog._id.toString()
                });
                process.stdout.write(`  Generated ${dataset.length}/${numSamples}\r`);
            }
        } catch (e) {
            console.warn(`\n  Skipping blog ${blog._id}: ${e.message.substring(0, 60)}`);
        }
        await sleep(300);
    }
    console.log(`\nGenerated ${dataset.length} QA pairs.`);
    return dataset;
}

// ── Retrieval Eval ────────────────────────────────────────────────────
async function evaluateRetrieval(dataset) {
    console.log('--- Evaluating Retrieval ---');
    let mrrSum = 0, hits = 0;
    for (const d of dataset) {
        const results = (await semanticSearchService.searchBlogs(d.query, { limit: 5 })) || [];
        const rank = results.findIndex(r => r.id === d.blogId) + 1;
        if (rank > 0) { mrrSum += 1 / rank; if (rank <= 5) hits++; }
    }
    const mrr = mrrSum / dataset.length;
    const r5  = hits   / dataset.length;
    console.log(`MRR: ${mrr.toFixed(2)}`);
    console.log(`Recall@5: ${(r5 * 100).toFixed(2)}%`);
    return { mrr, r5 };
}

// ── Generation Eval ───────────────────────────────────────────────────
async function evaluateGeneration(dataset) {
    console.log('--- Evaluating Generation (LLM-as-a-judge) ---');
    let faith = 0, rel = 0, comp = 0, clar = 0, done = 0;

    for (let i = 0; i < dataset.length; i++) {
        const d = dataset[i];
        process.stdout.write(`  Evaluating ${i + 1}/${dataset.length}...\r`);
        try {
            const results  = (await semanticSearchService.searchBlogs(d.query, { limit: 3 })) || [];
            const snippets = results.map(r => ({ title: r.title, snippet: r.snippet }));
            const ragResp  = await callWithRetry(() => llmService.generateRagAnswer(d.query, snippets, 'detailed'));
            const answer   = sanitize(ragResp.answer, 400);
            const ctx      = snippets.map(s => sanitize(s.snippet || '', 150)).join(' ').substring(0, 400);
            const query    = sanitize(d.query, 120);

            await sleep(400);

            const judgePrompts = [
                `Does the ANSWER use ONLY information from the CONTEXT? Reply with digit 1 (yes) or 0 (no).\nCONTEXT: ${ctx}\nANSWER: ${answer}`,
                `Does the ANSWER directly address the QUERY? Reply with digit 1 (yes) or 0 (no).\nQUERY: ${query}\nANSWER: ${answer}`,
                `Does the ANSWER fully and completely address the QUERY? Reply with digit 1 (yes) or 0 (no).\nQUERY: ${query}\nANSWER: ${answer}`,
                `Is the ANSWER clearly written and well-structured? Reply with digit 1 (yes) or 0 (no).\nANSWER: ${answer}`
            ];

            const scores = [];
            for (const prompt of judgePrompts) {
                const score = await callWithRetry(async () => {
                    const groq = getGroqClient();
                    const res = await groq.chat.completions.create({
                        messages: [{ role: 'user', content: prompt }],
                        model: MODEL,
                        max_tokens: 200,
                        temperature: 0
                    });
                    return parseBinaryScore(res.choices[0].message.content);
                });
                scores.push(score);
                await sleep(200);
            }

            faith += scores[0]; rel += scores[1]; comp += scores[2]; clar += scores[3];
            done++;
        } catch (e) {
            console.error(`\n  Eval failed [${i + 1}]: ${e.message.substring(0, 80)}`);
        }
        await sleep(600);
    }

    const n = dataset.length;
    console.log(`\n--- Generation Results (${done}/${n} evaluated) ---`);
    console.log(`Faithfulness:     ${(faith / n * 100).toFixed(2)}%`);
    console.log(`Answer Relevance: ${(rel   / n * 100).toFixed(2)}%`);
    console.log(`Completeness:     ${(comp  / n * 100).toFixed(2)}%`);
    console.log(`Clarity:          ${(clar  / n * 100).toFixed(2)}%`);
}

// ── Main ──────────────────────────────────────────────────────────────
async function runBenchmark() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/BlogDataBase');
        console.log('Connected to MongoDB');
        const dataset = await generateSyntheticDataset(25);
        if (!dataset.length) { console.log('No data.'); process.exit(1); }
        await evaluateRetrieval(dataset);
        await evaluateGeneration(dataset);
        console.log('--- Benchmarking Complete ---');
        process.exit(0);
    } catch (err) {
        console.error('Benchmarking failed:', err);
        process.exit(1);
    }
}

runBenchmark();
