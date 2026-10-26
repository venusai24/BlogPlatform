const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const config = require('../src/config');
const logger = require('../src/utils/logger');

let snsClient = null;
function getClient() {
    if (!snsClient) {
        snsClient = new SNSClient({ region: config.awsRegion });
    }
    return snsClient;
}

// BullMQ emits 'failed' on every failed attempt, including ones that will be retried.
// A failure is final when BullMQ stamped finishedOn, the configured attempts are used up
// (a queue without `attempts` gets a single attempt), or the error was unrecoverable.
function isFinalFailure(job, err) {
    if (!job) return true;
    const maxAttempts = Math.max(job.opts?.attempts || 1, 1);
    return Boolean(job.finishedOn)
        || job.attemptsMade >= maxAttempts
        || err?.name === 'UnrecoverableError';
}

// In-process dedupe: the same queue + error message alerts at most once per window, so a bad
// deploy or a down dependency does not send one email per failed job.
const DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const recentAlerts = new Map();

function claimAlert(key, now) {
    for (const [existing, alertedAt] of recentAlerts) {
        if (now - alertedAt >= DEDUPE_WINDOW_MS) recentAlerts.delete(existing);
    }
    if (recentAlerts.has(key)) return false;
    recentAlerts.set(key, now);
    return true;
}

function resetAlertDedupe() {
    recentAlerts.clear();
}

function buildMessage(queueName, job, err) {
    // job.data is deliberately left out: summarize jobs carry the full post text.
    return [
        `Queue: ${queueName}`,
        `Job: ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'})`,
        job?.data?.blogId ? `Blog: ${job.data.blogId}` : null,
        `Attempts made: ${job?.attemptsMade ?? 'unknown'}`,
        `Error: ${String(err?.message ?? 'unknown').slice(0, 1000)}`
    ].filter(Boolean).join('\n');
}

// Never throws: an alerting failure must not disturb the worker that reported it.
async function publishJobFailureAlert(queueName, job, err) {
    if (!config.alertsTopicArn) {
        logger.warn({ queue: queueName, jobId: job?.id }, 'ALERTS_TOPIC_ARN not set; skipping SNS failure alert');
        return false;
    }

    const dedupeKey = `${queueName}:${err?.message}`;
    if (!claimAlert(dedupeKey, Date.now())) {
        logger.info({ queue: queueName, jobId: job?.id }, 'Duplicate job failure alert suppressed');
        return false;
    }

    try {
        await getClient().send(new PublishCommand({
            TopicArn: config.alertsTopicArn,
            Subject: `[BlogPlatform] ${queueName} job failed`,
            Message: buildMessage(queueName, job, err),
            MessageAttributes: {
                queue: { DataType: 'String', StringValue: queueName }
            }
        }));
        return true;
    } catch (publishErr) {
        recentAlerts.delete(dedupeKey); // a failed publish must not suppress the next attempt
        logger.error({ err: publishErr, queue: queueName, jobId: job?.id }, 'Failed to publish job failure alert to SNS');
        return false;
    }
}

async function handleJobFailure(queueName, job, err) {
    if (!isFinalFailure(job, err)) return false;
    return publishJobFailureAlert(queueName, job, err);
}

module.exports = { isFinalFailure, publishJobFailureAlert, handleJobFailure, resetAlertDedupe };
