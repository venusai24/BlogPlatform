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

# The ops topic ARN comes from the persistent stack; the override above supplies it.

run "alarms_off_by_default" {
  command = plan

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.indexing_dlq_depth) == 0 && length(aws_cloudwatch_metric_alarm.indexing_age) == 0
    error_message = "no indexing alarms unless events are enabled"
  }
}

run "dlq_alarm" {
  command = plan

  variables {
    enable_worker_service = true
    enable_domain_events  = true
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].alarm_actions, "arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts")
    error_message = "DLQ alarm notifies the ops topic from the persistent stack"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].metric_name == "ApproximateNumberOfMessagesVisible" && aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].namespace == "AWS/SQS"
    error_message = "DLQ alarm metric"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].statistic == "Maximum" && aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].period == 300
    error_message = "DLQ alarm statistic and period"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].threshold == 0 && aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].comparison_operator == "GreaterThanThreshold" && aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].evaluation_periods == 1
    error_message = "DLQ alarm fires on any visible message"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.indexing_dlq_depth[0].treat_missing_data == "notBreaching"
    error_message = "missing data must not alarm"
  }
}

run "age_alarm" {
  command = plan

  variables {
    enable_worker_service = true
    enable_domain_events  = true
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.indexing_age[0].alarm_actions, "arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts")
    error_message = "age alarm notifies the ops topic"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.indexing_age[0].metric_name == "ApproximateAgeOfOldestMessage" && aws_cloudwatch_metric_alarm.indexing_age[0].threshold == 600
    error_message = "age alarm metric and threshold"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.indexing_age[0].statistic == "Maximum" && aws_cloudwatch_metric_alarm.indexing_age[0].period == 300 && aws_cloudwatch_metric_alarm.indexing_age[0].evaluation_periods == 2
    error_message = "age alarm statistic, period and evaluation periods"
  }
}

run "alerts_use_the_persistent_topic" {
  command = plan

  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "ALERTS_TOPIC_ARN=arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts")
    error_message = "ALERTS_TOPIC_ARN comes from the persistent stack"
  }
  assert {
    condition     = local.ecs_task_policy_statements[0].Resource == "arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts"
    error_message = "the task role may publish to the persistent ops topic"
  }
}

run "reconcile_defaults" {
  command = plan

  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "RECONCILE_INTERVAL_MS=0") && contains([for e in local.worker_environment : "${e.name}=${e.value}"], "RECONCILE_DRY_RUN=true")
    error_message = "the reconciliation sweep is off and a dry run by default"
  }
}

run "reconcile_configured" {
  command = plan

  variables {
    reconcile_interval_ms = "21600000"
    reconcile_dry_run     = "false"
  }

  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "RECONCILE_INTERVAL_MS=21600000") && contains([for e in local.worker_environment : "${e.name}=${e.value}"], "RECONCILE_DRY_RUN=false")
    error_message = "reconcile variables reach the worker environment"
  }
}
