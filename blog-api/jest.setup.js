process.env.PORT = '5000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.QDRANT_URL = 'http://localhost:6333';
process.env.EMBEDDING_PROVIDER = 'local';
process.env.EMBEDDING_MODEL_ID = 'sentence-transformers/all-MiniLM-L6-v2';
process.env.EMBEDDING_DIM = '384';
process.env.SUMMARY_PROVIDER = 'groq';
process.env.SUMMARY_MODEL_ID = 'llama-3.3-70b-versatile';
process.env.AWS_REGION = 'us-east-1';
process.env.JWT_SECRET = 'testsecret';

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    isOpen: false,
    ping: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    quit: jest.fn()
  }))
}));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn()
  })),
  Worker: jest.fn()
}));

jest.mock('./config/dbConn', () => jest.fn().mockResolvedValue());
