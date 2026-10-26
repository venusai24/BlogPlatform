const express = require('express');
const app = express();
app.set('trust proxy', 1); // the ALB is the only hop in front of the API
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const pinoHttp = require('pino-http');
const logger = require('./src/utils/logger');
const { initQdrant, getQdrantClient } = require('./services/qdrantService');
const mongoose = require('mongoose');
const redisClient = require('./services/redisClient'); // using default export based on common pattern, will check
const { isAdapterReady } = require('./socket');
const config = require('./src/config');
const httpMetrics = require('./middlewares/httpMetrics');

app.use(pinoHttp({
  logger,
  genReqId: function (req, res) {
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    return req.id;
  }
}));

app.use(httpMetrics);

// CORS goes first so preflights and error responses carry the right headers.
app.use(cors({
    origin: config.corsAllowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/ready', async (req, res) => {
    try {
        const mongoStatus = mongoose.connection.readyState === 1;
        let redisStatus = false;
        try {
            if (redisClient.isReady) {
                redisStatus = true;
            } else {
                await redisClient.ping();
                redisStatus = true;
            }
        } catch(e) {
            logger.warn({err: e}, "Redis not ready");
        }
        
        let qdrantStatus = false;
        try {
            await getQdrantClient().getCollections();
            qdrantStatus = true;
        } catch(e) {
            logger.warn({err: e}, "Qdrant not ready");
        }

        if (mongoStatus && redisStatus && qdrantStatus) {
            res.status(200).json({ status: 'ready', mongo: mongoStatus, redis: redisStatus, qdrant: qdrantStatus, socketAdapter: isAdapterReady() });
        } else {
            res.status(503).json({ status: 'not ready', mongo: mongoStatus, redis: redisStatus, qdrant: qdrantStatus, socketAdapter: isAdapterReady() });
        }
    } catch (error) {
        logger.error({err: error}, "Error checking readiness");
        res.status(503).json({ status: 'not ready', error: error.message });
    }
});
const authRoutes = require('./routes/auth');
const blogRoutes = require('./routes/blogs');
const errorHandler = require('./middlewares/errorHandler');

app.use('/auth', authRoutes);
app.use('/blogs', blogRoutes);
app.use(errorHandler);

// Initialize Qdrant when the app starts
(async () => {
    try {
        await initQdrant();
        logger.info('Qdrant initialized successfully');
    } catch (error) {
        logger.error({ err: error }, 'Failed to initialize Qdrant');
    }
})();

module.exports = app;