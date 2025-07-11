const express = require('express');
const app = express();
const cors = require('cors');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const authRoutes = require('./blog-api/routes/auth');
const blogRoutes = require('./blog-api/routes/blogs');
const errorHandler = require('./blog-api/middlewares/errorHandler');

app.use(cors({
    origin: 'http://localhost:3000', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/auth', authRoutes);
app.use('/blogs', blogRoutes);
app.use(errorHandler);

module.exports = app;