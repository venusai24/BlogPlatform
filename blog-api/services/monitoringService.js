const MonitoringLog = require('../model/MonitoringLog');
const logger = require('../src/utils/logger');

class MonitoringService {
    async logRagGeneration(data) {
        try {
            const log = new MonitoringLog({
                type: 'RAG_GENERATION',
                ...data
            });
            await log.save();
            return log._id;
        } catch (error) {
            logger.error({ err: error }, 'Error logging RAG generation');
            return null;
        }
    }

    async logFeedback(generationId, feedbackScore, feedbackText) {
        try {
            const log = new MonitoringLog({
                type: 'RAG_FEEDBACK',
                generationId,
                feedbackScore,
                feedbackText
            });
            await log.save();
            return log._id;
        } catch (error) {
            logger.error({ err: error }, 'Error logging RAG feedback');
            return null;
        }
    }

    async logQueryDrift(query, embedding) {
        try {
            const log = new MonitoringLog({
                type: 'RETRIEVAL_DRIFT',
                query,
                queryEmbedding: embedding
            });
            await log.save();
            return log._id;
        } catch (error) {
            logger.error({ err: error }, 'Error logging query drift');
            return null;
        }
    }

    // A helper method for checking online/offline gap or drift detection algorithms could be added here
}

module.exports = new MonitoringService();
