const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
  PublishCommand: jest.fn(input => ({ input }))
}));
jest.mock('../../model/Outbox', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
  countDocuments: jest.fn().mockResolvedValue(0)
}));
jest.mock('../../model/BlogContent', () => {
  const BlogContent = jest.fn().mockImplementation(doc => ({
    ...doc,
    _id: { toString: () => 'blog-id-1' },
    save: jest.fn().mockResolvedValue()
  }));
  BlogContent.deleteOne = jest.fn().mockResolvedValue({});
  return BlogContent;
});
jest.mock('../indexing/postIndexer', () => ({ reconcilePost: jest.fn() }));
jest.mock('../indexingQueue', () => ({ add: jest.fn() }));
jest.mock('../events/outbox', () => ({ appendEvent: jest.fn().mockResolvedValue() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/utils/metrics', () => ({ emitMetric: jest.fn() }));

const { trace, SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const mongoose = require('mongoose');
const { setupTracing, TRACE_ID, SPAN_ID, TRACEPARENT } = require('../../test/helpers/otel');
const config = require('../../src/config');
const Outbox = require('../../model/Outbox');
const postIndexer = require('../indexing/postIndexer');
const { appendEvent } = require('../events/outbox');
const { handle } = require('../consumers/indexingConsumer');
const relay = require('../events/outboxRelay');
const { createPost } = require('../postWriter');

const POST_ID = '64b7f0c2a1b2c3d4e5f60718';
const NOW = new Date('2026-01-01T00:00:00.000Z');

const message = (overrides = {}) => ({
  MessageId: 'sqs-1',
  Body: JSON.stringify({
    specversion: '1.0',
    id: '64b7f0c2a1b2c3d4e5f60999',
    type: 'blog.post.updated',
    source: 'blog-api',
    subject: POST_ID,
    time: new Date(Date.now() - 1500).toISOString(),
    traceparent: TRACEPARENT,
    data: { postId: POST_ID, revision: 2 },
    ...overrides
  })
});
const parentSpanId = span => (span.parentSpanContext ? span.parentSpanContext.spanId : span.parentSpanId);

describe('tracing across the async path', () => {
  let tracing;
  beforeAll(() => { tracing = setupTracing(); });
  afterAll(() => tracing.teardown());
  beforeEach(() => {
    tracing.reset();
    jest.clearAllMocks();
    postIndexer.reconcilePost.mockResolvedValue({ action: 'indexed' });
  });

  describe('indexing consumer', () => {
    it('consumer span is a child of the originating trace', async () => {
      await handle(message(), 'active');

      const [span] = tracing.finishedSpans('indexing.consume');
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(parentSpanId(span)).toBe(SPAN_ID);
      expect(span.kind).toBe(SpanKind.CONSUMER);
    });

    it('records messaging attributes and the outbox-to-consume latency', async () => {
      await handle(message(), 'active');

      const [span] = tracing.finishedSpans('indexing.consume');
      expect(span.attributes['messaging.system']).toBe('aws_sqs');
      expect(span.attributes['messaging.message.id']).toBe('sqs-1');
      expect(span.attributes['cloudevents.event_id']).toBe('64b7f0c2a1b2c3d4e5f60999');
      expect(span.attributes['blog.outbox_to_consume_ms']).toBeGreaterThanOrEqual(1500);
      expect(span.attributes['blog.outbox_to_consume_ms']).toBeLessThan(10000);
    });

    it('starts a new trace when the event has no traceparent (tracing was off at write time)', async () => {
      await handle(message({ traceparent: undefined }), 'active');

      const [span] = tracing.finishedSpans('indexing.consume');
      expect(span.spanContext().traceId).not.toBe(TRACE_ID);
      expect(parentSpanId(span)).toBeUndefined();
    });

    it('marks the span as an error and rethrows when reconcile fails', async () => {
      postIndexer.reconcilePost.mockRejectedValue(new Error('embed failed'));

      await expect(handle(message(), 'active')).rejects.toThrow('embed failed');

      const [span] = tracing.finishedSpans('indexing.consume');
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some(e => e.name === 'exception')).toBe(true);
    });

    it('still produces an (error) span for a malformed message', async () => {
      await expect(handle({ MessageId: 'sqs-2', Body: 'nope' }, 'active')).rejects.toThrow();

      const [span] = tracing.finishedSpans('indexing.consume');
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('reconcile runs inside the consumer span', async () => {
      let activeDuringReconcile;
      postIndexer.reconcilePost.mockImplementation(async () => {
        activeDuringReconcile = trace.getActiveSpan()?.spanContext().traceId;
        return { action: 'indexed' };
      });

      await handle(message(), 'active');

      expect(activeDuringReconcile).toBe(TRACE_ID);
    });
  });

  describe('outbox relay', () => {
    const doc = (traceparent) => ({
      _id: 'o1',
      attempts: 1,
      envelope: { id: 'o1', type: 'blog.post.created', ...(traceparent ? { traceparent } : {}), data: { postId: 'p', revision: 1 } }
    });

    beforeEach(() => {
      config.domainEventsTopicArn = 'arn:aws:sns:ap-south-1:123456789012:domain-events';
      mockSend.mockResolvedValue({});
    });

    it('relay span links to the originating trace', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc(TRACEPARENT)).mockResolvedValueOnce(null);

      await relay.runOnce(NOW);

      const [span] = tracing.finishedSpans('outbox.publish');
      expect(span.kind).toBe(SpanKind.PRODUCER);
      expect(span.links).toHaveLength(1);
      expect(span.links[0].context.traceId).toBe(TRACE_ID);
      expect(span.links[0].context.spanId).toBe(SPAN_ID);
      expect(span.attributes['messaging.system']).toBe('aws_sns');
      expect(span.attributes['messaging.destination.name']).toBe('domain-events');
      expect(span.attributes['cloudevents.event_id']).toBe('o1');
    });

    it('has no links when the event carries no traceparent', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc()).mockResolvedValueOnce(null);

      await relay.runOnce(NOW);

      expect(tracing.finishedSpans('outbox.publish')[0].links).toHaveLength(0);
    });

    it('ends the span with an error status when publishing fails, and still records the failure', async () => {
      Outbox.findOneAndUpdate.mockResolvedValueOnce(doc(TRACEPARENT)).mockResolvedValueOnce(null);
      mockSend.mockRejectedValue(new Error('sns down'));

      const result = await relay.runOnce(NOW);

      const [span] = tracing.finishedSpans('outbox.publish');
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(result).toEqual({ published: 0, failed: 1 });
    });
  });

  describe('postWriter', () => {
    let startSession;
    beforeEach(() => {
      config.indexingBackend = 'events';
      startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue({
        withTransaction: fn => fn(),
        endSession: jest.fn().mockResolvedValue()
      });
    });
    afterEach(() => {
      config.indexingBackend = 'bullmq';
      startSession.mockRestore();
    });

    it('passes traceparent into appendEvent when a span is active', async () => {
      await trace.getTracer('test').startActiveSpan('POST /blogs', async (span) => {
        await createPost({ title: 'T', content: 'C', author: 'a' });
        span.end();
        expect(appendEvent).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ traceparent: expect.stringContaining(`-${span.spanContext().spanId}-`) })
        );
      });
    });

    it('passes no traceparent when there is no active span', async () => {
      await createPost({ title: 'T', content: 'C', author: 'a' });

      expect(appendEvent.mock.calls[0][1].traceparent).toBeUndefined();
    });
  });
});
