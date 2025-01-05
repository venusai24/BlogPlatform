const express = require('express');
const app = express();

const authRoutes = require('./blog-api/routes/auth');
app.use(express.json());
app.use('/auth', authRoutes);
app.use(express.urlencoded({ extended: true }));


module.exports = app;