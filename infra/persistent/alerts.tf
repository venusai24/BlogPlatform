# Operational alerts live in the persistent stack so the email subscription is confirmed once and
# survives ephemeral teardowns. The topic is deliberately NOT encrypted: CloudWatch alarms cannot
# publish to a topic that uses the AWS-managed SNS key.
resource "aws_sns_topic" "ops_alerts" {
  name = "blogplatform-${var.env}-ops-alerts"
}

resource "aws_sns_topic_subscription" "ops_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

output "ops_alerts_topic_arn" {
  description = "ARN of the ops alerts SNS topic (read by the ephemeral stack)"
  value       = aws_sns_topic.ops_alerts.arn
}
