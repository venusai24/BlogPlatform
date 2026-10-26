// Experiment E4: publish a malformed event to the domain-events topic and watch it get isolated.
//
//   DOMAIN_EVENTS_TOPIC_ARN=arn:aws:sns:... AWS_REGION=ap-south-1 node scripts/publishPoisonMessage.js
//
// The envelope is well-formed JSON but its postId is not an ObjectId, so the indexing consumer throws
// PoisonMessageError on every attempt: the message is received five times, then lands in the DLQ and
// the DLQ alarm fires, while other messages carry on.
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

function buildPoisonCommand(topicArn) {
    const envelope = {
        specversion: '1.0',
        id: 'poison',
        type: 'blog.post.updated',
        source: 'experiment',
        subject: 'x',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: { postId: 'not-an-id', revision: 0 }
    };
    return new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(envelope),
        MessageAttributes: {
            eventType: { DataType: 'String', StringValue: envelope.type }
        }
    });
}

async function main(env = process.env) {
    const topicArn = env.DOMAIN_EVENTS_TOPIC_ARN;
    if (!topicArn) {
        throw new Error('DOMAIN_EVENTS_TOPIC_ARN is required');
    }
    const client = new SNSClient({ region: env.AWS_REGION });
    const { MessageId } = await client.send(buildPoisonCommand(topicArn));
    console.log(`Published poison message ${MessageId} to ${topicArn}`);
}

module.exports = { buildPoisonCommand, main };

if (require.main === module) {
    main().catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}
