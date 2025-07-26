const express = require('express');
const app = express();
const cors = require('cors');
const { initQdrant } = require('./services/qdrantService');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const authRoutes = require('./routes/auth');
const blogRoutes = require('./routes/blogs');
const errorHandler = require('./middlewares/errorHandler');

app.use(cors({
    origin: 'http://localhost:3000', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/auth', authRoutes);
app.use('/blogs', blogRoutes);
app.use(errorHandler);

// Initialize Qdrant when the app starts
(async () => {
    try {
        await initQdrant();
        console.log('Qdrant initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Qdrant:', error);
    }
})();

module.exports = app;