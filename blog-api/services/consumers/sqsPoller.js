const { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } = require('@aws-sdk/client-sqs');
const config = require('../../src/config');
const logger = require('../../src/utils/logger');

const RECEIVE_ERROR_PAUSE_MS = 5000;

// Long-polls one SQS queue. A message is deleted only after its handler resolves; a rejected message
// stays on the queue, is redelivered after the visibility timeout, and lands in the DLQ once the
// queue's maxReceiveCount is reached. Handlers must therefore be idempotent.
class SqsPoller {
    constructor({ queueUrl, handler, concurrency = 5, waitTimeSeconds = 20, maxMessages = 10, client }) {
        this.queueUrl = queueUrl;
        this.handler = handler;
        this.concurrency = concurrency;
        this.waitTimeSeconds = waitTimeSeconds;
        this.maxMessages = maxMessages;
        this.client = client || new SQSClient({ region: config.awsRegion });
        this.stopping = false;
        this.loopPromise = null;
        this.abortController = null;
        this.pauseTimer = null;
        this.wake = null;
    }

    start() {
        if (!this.loopPromise) {
            this.stopping = false;
            this.loopPromise = this.run();
        }
        return this.loopPromise;
    }

    async stop() {
        this.stopping = true;
        if (this.abortController) this.abortController.abort(); // cut a 20s long poll short
        if (this.pauseTimer) {
            clearTimeout(this.pauseTimer);
            this.wake();
        }
        if (this.loopPromise) await this.loopPromise;
        this.loopPromise = null;
    }

    async run() {
        while (!this.stopping) {
            let messages;
            try {
                messages = await this.receive();
            } catch (err) {
                if (this.stopping) break;
                logger.error({ err }, 'SQS receive failed');
                await this.pause(RECEIVE_ERROR_PAUSE_MS);
                continue;
            }
            if (messages.length > 0) {
                await this.processBatch(messages);
            }
        }
    }

    async receive() {
        this.abortController = new AbortController();
        try {
            const response = await this.client.send(
                new ReceiveMessageCommand({
                    QueueUrl: this.queueUrl,
                    MaxNumberOfMessages: this.maxMessages,
                    WaitTimeSeconds: this.waitTimeSeconds,
                    MessageSystemAttributeNames: ['ApproximateReceiveCount']
                }),
                { abortSignal: this.abortController.signal }
            );
            return response.Messages || [];
        } finally {
            this.abortController = null;
        }
    }

    async processBatch(messages) {
        const succeeded = [];

        for (let i = 0; i < messages.length; i += this.concurrency) {
            const chunk = messages.slice(i, i + this.concurrency);
            const results = await Promise.allSettled(chunk.map(message => this.handler(message)));
            results.forEach((result, index) => {
                const message = chunk[index];
                if (result.status === 'fulfilled') {
                    succeeded.push(message);
                } else {
                    logger.warn({
                        messageId: message.MessageId,
                        receiveCount: message.Attributes?.ApproximateReceiveCount,
                        err: result.reason
                    }, 'SQS message handler failed; leaving it on the queue');
                }
            });
        }

        if (succeeded.length === 0) return;
        try {
            const response = await this.client.send(new DeleteMessageBatchCommand({
                QueueUrl: this.queueUrl,
                Entries: succeeded.map((message, index) => ({ Id: String(index), ReceiptHandle: message.ReceiptHandle }))
            }));
            if (response?.Failed?.length) {
                logger.warn({ failed: response.Failed }, 'Some SQS messages could not be deleted; they will be redelivered');
            }
        } catch (err) {
            // The messages are redelivered and reprocessed, which handlers must tolerate.
            logger.error({ err }, 'SQS DeleteMessageBatch failed');
        }
    }

    pause(ms) {
        return new Promise(resolve => {
            this.wake = resolve;
            this.pauseTimer = setTimeout(() => {
                this.pauseTimer = null;
                resolve();
            }, ms);
            this.pauseTimer.unref();
        });
    }
}

module.exports = { SqsPoller };
