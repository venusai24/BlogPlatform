jest.mock('../../src/config', () => ({
    awsRegion: 'eu-north-1',
    alertsTopicArn: 'arn:aws:sns:eu-north-1:123456789012:blogplatform-alerts'
}));
jest.mock('../../src/utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
}));
jest.mock('@aws-sdk/client-sns', () => {
    const send = jest.fn();
    return {
        __send: send,
        SNSClient: jest.fn(() => ({ send })),
        PublishCommand: jest.fn(input => ({ input }))
    };
});

const config = require('../../src/config');
const logger = require('../../src/utils/logger');
const { __send: send, PublishCommand } = require('@aws-sdk/client-sns');
const { isFinalFailure, publishJobFailureAlert, handleJobFailure, resetAlertDedupe } = require('../alertService');

const TOPIC_ARN = config.alertsTopicArn;

const makeJob = (overrides = {}) => ({
    id: '42',
    name: 'index-blog',
    data: { blogId: 'blog-1' },
    opts: { attempts: 3 },
    attemptsMade: 3,
    ...overrides
});

describe('alertService', () => {
    beforeEach(() => {
        resetAlertDedupe();
        config.alertsTopicArn = TOPIC_ARN;
        send.mockResolvedValue({ MessageId: 'm-1' });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('isFinalFailure', () => {
        it('treats a missing job as final', () => {
            expect(isFinalFailure(undefined, new Error('boom'))).toBe(true);
        });

        it('is not final while retries remain', () => {
            expect(isFinalFailure(makeJob({ attemptsMade: 1 }), new Error('boom'))).toBe(false);
            expect(isFinalFailure(makeJob({ attemptsMade: 2 }), new Error('boom'))).toBe(false);
        });

        it('is final once the configured attempts are used up', () => {
            expect(isFinalFailure(makeJob({ attemptsMade: 3 }), new Error('boom'))).toBe(true);
        });

        it('is final on the first failure when no attempts are configured', () => {
            expect(isFinalFailure(makeJob({ opts: {}, attemptsMade: 1 }), new Error('boom'))).toBe(true);
        });

        it('is final for an UnrecoverableError even with attempts left', () => {
            const err = new Error('do not retry');
            err.name = 'UnrecoverableError';
            expect(isFinalFailure(makeJob({ attemptsMade: 1 }), err)).toBe(true);
        });

        it('is final when BullMQ has stamped finishedOn', () => {
            expect(isFinalFailure(makeJob({ attemptsMade: 1, finishedOn: Date.now() }), new Error('boom'))).toBe(true);
        });
    });

    describe('publishJobFailureAlert', () => {
        it('skips publishing when ALERTS_TOPIC_ARN is not set', async () => {
            config.alertsTopicArn = undefined;

            await expect(publishJobFailureAlert('indexing', makeJob(), new Error('boom'))).resolves.toBe(false);

            expect(send).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });

        it('publishes queue, job and error details to the alerts topic', async () => {
            await expect(publishJobFailureAlert('indexing', makeJob(), new Error('qdrant down'))).resolves.toBe(true);

            expect(send).toHaveBeenCalledTimes(1);
            const input = PublishCommand.mock.calls[0][0];
            expect(input.TopicArn).toBe(TOPIC_ARN);
            expect(input.Subject).toBe('[BlogPlatform] indexing job failed');
            expect(input.Message).toContain('Queue: indexing');
            expect(input.Message).toContain('Job: 42 (index-blog)');
            expect(input.Message).toContain('Blog: blog-1');
            expect(input.Message).toContain('Attempts made: 3');
            expect(input.Message).toContain('Error: qdrant down');
            expect(input.MessageAttributes.queue).toEqual({ DataType: 'String', StringValue: 'indexing' });
        });

        it('does not leak job payload text into the alert', async () => {
            const job = makeJob({ name: 'summarize', data: { text: 'private draft body' }, opts: {}, attemptsMade: 1 });

            await publishJobFailureAlert('summarize', job, new Error('llm timeout'));

            expect(PublishCommand.mock.calls[0][0].Message).not.toContain('private draft body');
        });

        it('swallows SNS errors so the worker is not disturbed', async () => {
            send.mockRejectedValue(new Error('AccessDenied'));

            await expect(publishJobFailureAlert('indexing', makeJob(), new Error('boom'))).resolves.toBe(false);

            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('handleJobFailure', () => {
        it('does not alert on a failure that will be retried', async () => {
            await expect(handleJobFailure('indexing', makeJob({ attemptsMade: 1 }), new Error('boom'))).resolves.toBe(false);

            expect(send).not.toHaveBeenCalled();
        });

        it('alerts once retries are exhausted', async () => {
            await expect(handleJobFailure('indexing', makeJob(), new Error('boom'))).resolves.toBe(true);

            expect(send).toHaveBeenCalledTimes(1);
        });
    });

    describe('deduplication', () => {
        beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z')));
        afterEach(() => jest.useRealTimers());

        it('deduplicates identical failures within 15 minutes', async () => {
            await handleJobFailure('indexing', makeJob(), new Error('qdrant down'));
            await handleJobFailure('indexing', makeJob({ id: '43' }), new Error('qdrant down'));

            expect(send).toHaveBeenCalledTimes(1);

            jest.setSystemTime(new Date('2026-01-01T00:16:00Z'));
            await handleJobFailure('indexing', makeJob({ id: '44' }), new Error('qdrant down'));

            expect(send).toHaveBeenCalledTimes(2);
        });

        it('still alerts for a different queue or a different error', async () => {
            await handleJobFailure('indexing', makeJob(), new Error('qdrant down'));
            await handleJobFailure('summarize', makeJob(), new Error('qdrant down'));
            await handleJobFailure('indexing', makeJob(), new Error('embedding timeout'));

            expect(send).toHaveBeenCalledTimes(3);
        });

        it('does not suppress a retry after a failed publish', async () => {
            send.mockRejectedValueOnce(new Error('AccessDenied'));

            await handleJobFailure('indexing', makeJob(), new Error('qdrant down'));
            await handleJobFailure('indexing', makeJob(), new Error('qdrant down'));

            expect(send).toHaveBeenCalledTimes(2);
        });

        it('forgets entries older than 15 minutes', async () => {
            await handleJobFailure('indexing', makeJob(), new Error('first'));
            jest.setSystemTime(new Date('2026-01-01T00:20:00Z'));
            await handleJobFailure('indexing', makeJob(), new Error('second'));

            expect(send).toHaveBeenCalledTimes(2);
            // 'first' was pruned, so it alerts again right away.
            await handleJobFailure('indexing', makeJob(), new Error('first'));
            expect(send).toHaveBeenCalledTimes(3);
        });
    });
});
