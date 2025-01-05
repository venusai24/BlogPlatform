const express = require('express');
const app = express();

const authRoutes = require('./blog-api/routes/auth');

app.use('/auth', authRoutes);

module.exports = app;