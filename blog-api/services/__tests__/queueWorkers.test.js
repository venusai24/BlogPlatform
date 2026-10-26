jest.mock('bullmq', () => ({
    Queue: jest.fn(),
    Worker: jest.fn(name => ({ name, on: jest.fn() }))
}));
jest.mock('../alertService', () => ({ handleJobFailure: jest.fn() }));
jest.mock('../indexing/postIndexer', () => ({ reconcilePost: jest.fn(), removePost: jest.fn() }));
jest.mock('../summarize', () => ({ summarizeJob: jest.fn() }));
jest.mock('../../model/BlogContent', () => ({}));

const { Queue, Worker } = require('bullmq');
const alertService = require('../alertService');

require('../indexingQueue');
require('../queue');
require('../indexingWorker');
require('../summarizeWorker');

const failedHandlerFor = queueName => {
    const index = Worker.mock.calls.findIndex(call => call[0] === queueName);
    const { on } = Worker.mock.results[index].value;
    return on.mock.calls.find(call => call[0] === 'failed')[1];
};

describe('queue retry configuration', () => {
    it('sets retries on the indexing queue as job options', () => {
        expect(Queue).toHaveBeenCalledWith('indexing', expect.objectContaining({
            defaultJobOptions: expect.objectContaining({
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            })
        }));
    });

    it('does not pass retry options to the indexing worker, where BullMQ ignores them', () => {
        const workerOptions = Worker.mock.calls.find(call => call[0] === 'indexing')[2];

        expect(workerOptions).not.toHaveProperty('attempts');
        expect(workerOptions).not.toHaveProperty('backoff');
    });

    it('leaves the summarize queue without retries so status polling never reports a retrying job as failed', () => {
        const options = Queue.mock.calls.find(call => call[0] === 'summarize')[1];

        expect(options.defaultJobOptions.attempts).toBe(1);
    });
});

describe('queue and worker hygiene', () => {
    it('summarize queue drops finished jobs', () => {
        const options = Queue.mock.calls.find(call => call[0] === 'summarize')[1];

        expect(options.defaultJobOptions).toEqual({
            attempts: 1,
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86400, count: 1000 }
        });
    });

    it('indexing queue drops finished jobs', () => {
        const options = Queue.mock.calls.find(call => call[0] === 'indexing')[1];

        expect(options.defaultJobOptions).toEqual({
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 604800 }
        });
    });

    it('workers set concurrency', () => {
        expect(Worker.mock.calls.find(call => call[0] === 'indexing')[2].concurrency).toBe(2);
        expect(Worker.mock.calls.find(call => call[0] === 'summarize')[2].concurrency).toBe(1);
    });

    it('queues and workers share the BullMQ connection helper (maxRetriesPerRequest null)', () => {
        for (const [, options] of Queue.mock.calls) {
            expect(options.connection.maxRetriesPerRequest).toBeNull();
        }
        for (const call of Worker.mock.calls) {
            expect(call[2].connection.maxRetriesPerRequest).toBeNull();
        }
    });
});

describe('worker failure alerting', () => {
    afterEach(() => {
        alertService.handleJobFailure.mockClear();
    });

    it.each(['indexing', 'summarize'])('reports %s job failures to the alert service', queueName => {
        const job = { id: '7', name: 'job' };
        const err = new Error('boom');

        failedHandlerFor(queueName)(job, err);

        expect(alertService.handleJobFailure).toHaveBeenCalledWith(queueName, job, err);
    });

    it.each(['indexing', 'summarize'])('%s handler tolerates a missing job', queueName => {
        expect(() => failedHandlerFor(queueName)(undefined, new Error('stalled'))).not.toThrow();
        expect(alertService.handleJobFailure).toHaveBeenCalledWith(queueName, undefined, expect.any(Error));
    });
});

describe('indexing worker jobs', () => {
    const postIndexer = require('../indexing/postIndexer');
    // Captured at collection time, before any mock is cleared.
    const indexingProcessor = Worker.mock.calls.find(call => call[0] === 'indexing')[1];
    const processorFor = () => indexingProcessor;

    beforeEach(() => {
        postIndexer.reconcilePost.mockReset();
        postIndexer.removePost.mockReset();
    });

    it("'index-blog' reconciles the post against Mongo", async () => {
        postIndexer.reconcilePost.mockResolvedValue({ action: 'indexed' });

        await processorFor('indexing')({ id: '1', name: 'index-blog', data: { blogId: 'p1' } });

        expect(postIndexer.reconcilePost).toHaveBeenCalledWith('p1');
    });

    it("'index-blog' for a deleted post does not throw (reconcile removes its vectors)", async () => {
        postIndexer.reconcilePost.mockResolvedValue({ action: 'removed' });

        await expect(processorFor('indexing')({ id: '1', name: 'index-blog', data: { blogId: 'gone' } })).resolves.not.toThrow();
    });

    it("'delete-blog-embeddings' removes the post's vectors", async () => {
        await processorFor('indexing')({ id: '2', name: 'delete-blog-embeddings', data: { blogId: 'p1' } });

        expect(postIndexer.removePost).toHaveBeenCalledWith('p1');
    });

    it('rejects an unknown job name', async () => {
        await expect(processorFor('indexing')({ id: '3', name: 'nope', data: {} })).rejects.toThrow('Unknown job name');
    });
});
