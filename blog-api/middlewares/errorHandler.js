const logger = require('../src/utils/logger');

function errorHandler(err, req, res, next) {
    (req.log || logger).error({ err }, 'Unhandled error');
    res.status(500).json({ message: 'Internal Server Error', requestId: req.id });
}

module.exports = errorHandler;
