const express = require('express');
const app = express();
const cors = require('cors');

const authRoutes = require('./blog-api/routes/auth');
const blogRoutes = require('./blog-api/routes/blogs');
app.use(cors({
    origin: 'http://localhost:3000', // Allow requests from React frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/blogs', blogRoutes);
app.use(express.urlencoded({ extended: true }));




module.exports = app;