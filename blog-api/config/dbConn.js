const mongoose = require('mongoose');
const config = require('../src/config');
const logger = require('../src/utils/logger');

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongodbUri, { maxPoolSize: config.mongoMaxPoolSize });
        logger.info('MongoDB connected');
    } catch (err) {
        logger.error({ err }, 'MongoDB connection error');
        throw err;
    }
};

module.exports = connectDB;
