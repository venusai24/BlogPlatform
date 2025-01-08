const express = require('express');
const app = express();

const authRoutes = require('./blog-api/routes/auth');
const blogRoutes = require('./blog-api/routes/blogs');
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/blogs', blogRoutes);
app.use(express.urlencoded({ extended: true }));


module.exports = app;