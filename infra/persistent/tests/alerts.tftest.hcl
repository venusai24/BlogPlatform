mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

variables {
  github_repo  = "venusai24/BlogPlatform"
  budget_email = "ops@example.com"
  alert_email  = "ops@example.com"
}

run "ops_alerts_topic" {
  command = plan

  assert {
    condition     = aws_sns_topic.ops_alerts.name == "blogplatform-prod-ops-alerts"
    error_message = "ops alerts topic name"
  }
  assert {
    condition     = aws_sns_topic.ops_alerts.kms_master_key_id == null
    error_message = "the topic must stay unencrypted: CloudWatch alarms cannot publish to a topic using the AWS-managed SNS key"
  }
}

run "ops_email_subscription" {
  command = plan

  assert {
    condition     = aws_sns_topic_subscription.ops_email.protocol == "email"
    error_message = "email subscription"
  }
  assert {
    condition     = aws_sns_topic_subscription.ops_email.endpoint == "ops@example.com"
    error_message = "subscription endpoint comes from alert_email"
  }
}
