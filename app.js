const express = require('express');
const app = express();

const authRoutes = require('./blog-api/routes/auth');

app.use('/auth', authRoutes);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

module.exports = app;