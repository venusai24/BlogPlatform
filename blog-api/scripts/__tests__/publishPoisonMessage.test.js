jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: jest.fn() })),
  PublishCommand: jest.fn(input => ({ input }))
}));

const { buildPoisonCommand } = require('../publishPoisonMessage');

const TOPIC = 'arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-domain-events';

describe('publishPoisonMessage', () => {
  it('builds a publish command with the eventType attribute SNS filters on', () => {
    const command = buildPoisonCommand(TOPIC);

    expect(command.input.TopicArn).toBe(TOPIC);
    expect(command.input.MessageAttributes.eventType).toEqual({ DataType: 'String', StringValue: 'blog.post.updated' });
  });

  it('carries a well-formed envelope whose postId can never be valid', () => {
    const envelope = JSON.parse(buildPoisonCommand(TOPIC).input.Message);

    expect(envelope).toEqual(expect.objectContaining({
      specversion: '1.0',
      id: 'poison',
      type: 'blog.post.updated',
      source: 'experiment',
      subject: 'x',
      datacontenttype: 'application/json',
      data: { postId: 'not-an-id', revision: 0 }
    }));
    expect(new Date(envelope.time).toString()).not.toBe('Invalid Date');
  });

  it('is rejected by the real consumer as a poison message', async () => {
    jest.resetModules();
    jest.doMock('../../services/indexing/postIndexer', () => ({ reconcilePost: jest.fn() }));
    jest.doMock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
    jest.doMock('../../src/utils/metrics', () => ({ emitMetric: jest.fn() }));
    const { buildPoisonCommand: build } = require('../publishPoisonMessage');
    const { handle, PoisonMessageError } = require('../../services/consumers/indexingConsumer');

    await expect(handle({ MessageId: 'm', Body: build(TOPIC).input.Message }, 'active')).rejects.toBeInstanceOf(PoisonMessageError);
  });

  it('refuses to run without a topic ARN', async () => {
    const { main } = require('../publishPoisonMessage');
    await expect(main({})).rejects.toThrow('DOMAIN_EVENTS_TOPIC_ARN');
  });
});
