const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const config = require('../../src/config');

let snsClient = null;
function getClient() {
    if (!snsClient) {
        snsClient = new SNSClient({ region: config.awsRegion });
    }
    return snsClient;
}

// Publishes one domain event. `eventType` is a message attribute so SNS filter policies
// (subscription side) can route on it without parsing the body.
async function publish(envelope) {
    await getClient().send(new PublishCommand({
        TopicArn: config.domainEventsTopicArn,
        Message: JSON.stringify(envelope),
        MessageAttributes: {
            eventType: { DataType: 'String', StringValue: envelope.type }
        }
    }));
}

module.exports = { publish };
