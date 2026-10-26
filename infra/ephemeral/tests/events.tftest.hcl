mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

mock_provider "random" {}

mock_provider "aws" {
  alias = "us_east_1"
}

override_data {
  target = data.terraform_remote_state.persistent
  values = { outputs = {
    ecr_repository_url     = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-api"
    ops_alerts_topic_arn   = "arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts"
    app_certificate_arn    = "arn:aws:acm:ap-south-1:123456789012:certificate/test"
    hosted_zone_id         = "Z123"
    nat_eip_allocation_ids = ["eipalloc-0aaa", "eipalloc-0bbb"]
    nat_eip_public_ips     = ["203.0.113.10", "203.0.113.11"]
    web_ecr_repository_url = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-web"
  } }
}

variables {
  state_bucket = "test-bucket"
}

# Assertions use locals where the value would otherwise be unknown at plan time
# (e.g. a redrive policy that embeds the DLQ ARN).

run "events_off" {
  command = plan

  assert {
    condition     = length(aws_sqs_queue.indexing) == 0 && length(aws_sqs_queue.indexing_dlq) == 0
    error_message = "no indexing queues by default"
  }
  assert {
    condition     = length(aws_sns_topic.domain_events) == 0 && length(aws_sns_topic_subscription.indexing) == 0
    error_message = "no domain-events topic or subscription by default"
  }
  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "INDEXING_BACKEND=bullmq")
    error_message = "INDEXING_BACKEND defaults to bullmq"
  }
  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "DOMAIN_EVENTS_TOPIC_ARN=") && contains([for e in local.common_environment : "${e.name}=${e.value}"], "INDEXING_QUEUE_URL=")
    error_message = "topic ARN and queue URL are empty when events are off"
  }
  assert {
    condition     = !contains([for e in local.common_environment : e.name], "ASYNC_EMBEDDING") && !contains([for e in local.common_environment : e.name], "EMBEDDING_QUEUE_URL")
    error_message = "the old embedding queue variables are gone"
  }
  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "OUTBOX_RELAY_ENABLED=false") && contains([for e in local.worker_environment : "${e.name}=${e.value}"], "INDEXING_CONSUMER_MODE=off")
    error_message = "worker relay off and consumer mode off by default"
  }
  assert {
    condition     = length(local.ecs_task_policy_statements) == 2
    error_message = "task role has only the alerts and Bedrock statements when events are off"
  }
}

run "events_on" {
  command = plan

  variables {
    enable_worker_service = true
    enable_domain_events  = true
  }

  assert {
    condition     = local.indexing_redrive_policy.maxReceiveCount == 5
    error_message = "indexing queue redrives to the DLQ after 5 receives"
  }
  assert {
    condition     = aws_sqs_queue.indexing[0].visibility_timeout_seconds == 120 && aws_sqs_queue.indexing[0].receive_wait_time_seconds == 20 && aws_sqs_queue.indexing[0].message_retention_seconds == 345600
    error_message = "indexing queue timing"
  }
  assert {
    condition     = aws_sqs_queue.indexing_dlq[0].message_retention_seconds == 1209600
    error_message = "DLQ keeps messages 14 days"
  }
  assert {
    condition     = aws_sqs_queue.indexing[0].sqs_managed_sse_enabled == true && aws_sqs_queue.indexing_dlq[0].sqs_managed_sse_enabled == true
    error_message = "queues use SQS-managed encryption"
  }
  assert {
    condition     = aws_sns_topic_subscription.indexing[0].raw_message_delivery == true
    error_message = "raw message delivery"
  }
  assert {
    condition     = aws_sns_topic_subscription.indexing[0].protocol == "sqs" && aws_sns_topic_subscription.indexing[0].filter_policy_scope == "MessageAttributes"
    error_message = "SQS subscription filtering on message attributes"
  }
  assert {
    condition     = jsondecode(aws_sns_topic_subscription.indexing[0].filter_policy).eventType[0].prefix == "blog.post."
    error_message = "filter policy prefix"
  }
  assert {
    condition     = aws_sns_topic.domain_events[0].kms_master_key_id == "alias/aws/sns"
    error_message = "topic encrypted with the AWS-managed SNS key"
  }
  assert {
    condition     = length(aws_sqs_queue_redrive_allow_policy.indexing_dlq) == 1
    error_message = "DLQ only accepts redrives from the indexing queue"
  }
  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "OUTBOX_RELAY_ENABLED=true")
    error_message = "worker runs the relay when events are on"
  }
  assert {
    condition     = length(local.ecs_task_policy_statements) == 4
    error_message = "task role gains publish and consume statements when events are on"
  }
}

run "events_require_worker" {
  command = plan

  variables {
    enable_domain_events = true
  }

  expect_failures = [aws_sns_topic.domain_events]
}

run "invalid_indexing_backend" {
  command = plan

  variables {
    indexing_backend = "kafka"
  }

  expect_failures = [var.indexing_backend]
}

run "invalid_consumer_mode" {
  command = plan

  variables {
    indexing_consumer_mode = "sometimes"
  }

  expect_failures = [var.indexing_consumer_mode]
}
