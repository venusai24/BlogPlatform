const { z } = require('zod');

const text = (min, max) => z.string().trim().min(min).max(max);

const createBlog = z.object({
  title: text(1, 200),
  content: text(1, 50000),
  summary: z.string().trim().max(5000).optional(),
  tags: z.array(text(1, 30)).max(10).optional(),
  // Only honoured on the legacy path (AUTH_REQUIRED_WRITES=false); otherwise the token's username wins.
  author: z.string().trim().max(64).optional()
});

const updateBlog = createBlog.partial().omit({ author: true });

const comment = z.object({ comment: text(1, 2000) });
const reply = z.object({ reply: text(1, 2000) });

// Query-string schema: values arrive as strings, so numbers are coerced.
const searchQuery = z.object({
  query: text(1, 500),
  searchType: z.enum(['content', 'title', 'hybrid']).default('content'),
  limit: z.coerce.number().int().min(1).max(20).default(10)
});

const ask = z.object({
  query: text(1, 500),
  detailLevel: z.enum(['brief', 'detailed']).default('brief'),
  limit: z.coerce.number().int().min(1).max(10).default(5)
});

const semanticTitle = z.object({
  query: text(1, 500),
  limit: z.number().int().min(1).max(20).default(10),
  threshold: z.number().min(0).max(1).default(0.3)
});

const summarize = z.object({
  content: text(1, 50000),
  model: z.string().trim().max(100).optional()
});

const retrieve = z.object({ titleQuery: text(1, 200) });

const register = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(8).max(128)
});

const login = z.object({
  username: text(1, 64),
  password: z.string().min(1).max(128)
});

const feedback = z.object({
  generationId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  feedbackScore: z.union([z.literal(1), z.literal(-1)]),
  feedbackText: z.string().trim().max(2000).optional()
});

module.exports = {
  createBlog,
  updateBlog,
  comment,
  reply,
  searchQuery,
  ask,
  semanticTitle,
  summarize,
  retrieve,
  register,
  login,
  feedback
};
