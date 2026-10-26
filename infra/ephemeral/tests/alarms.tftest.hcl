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

run "base_alarms_are_planned" {
  command = plan

  assert {
    condition = alltrue([
      for a in [
        aws_cloudwatch_metric_alarm.api_5xx,
        aws_cloudwatch_metric_alarm.api_unhealthy,
        aws_cloudwatch_metric_alarm.api_no_healthy,
        aws_cloudwatch_metric_alarm.llm_fallback
      ] : a.alarm_actions == toset(["arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts"])
    ])
    error_message = "every base alarm notifies the ops topic"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx.namespace == "AWS/ApplicationELB" && aws_cloudwatch_metric_alarm.api_5xx.metric_name == "HTTPCode_Target_5XX_Count" && aws_cloudwatch_metric_alarm.api_5xx.statistic == "Sum"
    error_message = "api-5xx metric"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx.threshold == 5 && aws_cloudwatch_metric_alarm.api_5xx.comparison_operator == "GreaterThanThreshold" && aws_cloudwatch_metric_alarm.api_5xx.period == 300 && aws_cloudwatch_metric_alarm.api_5xx.evaluation_periods == 1
    error_message = "api-5xx condition"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx.treat_missing_data == "notBreaching"
    error_message = "api-5xx missing data"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_unhealthy.metric_name == "UnHealthyHostCount" && aws_cloudwatch_metric_alarm.api_unhealthy.statistic == "Maximum" && aws_cloudwatch_metric_alarm.api_unhealthy.comparison_operator == "GreaterThanOrEqualToThreshold" && aws_cloudwatch_metric_alarm.api_unhealthy.threshold == 1 && aws_cloudwatch_metric_alarm.api_unhealthy.evaluation_periods == 3 && aws_cloudwatch_metric_alarm.api_unhealthy.period == 60
    error_message = "api-unhealthy condition"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_unhealthy.treat_missing_data == "notBreaching"
    error_message = "api-unhealthy missing data"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_no_healthy.metric_name == "HealthyHostCount" && aws_cloudwatch_metric_alarm.api_no_healthy.statistic == "Minimum" && aws_cloudwatch_metric_alarm.api_no_healthy.comparison_operator == "LessThanThreshold" && aws_cloudwatch_metric_alarm.api_no_healthy.threshold == 1 && aws_cloudwatch_metric_alarm.api_no_healthy.evaluation_periods == 3 && aws_cloudwatch_metric_alarm.api_no_healthy.period == 60
    error_message = "api-no-healthy condition"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_no_healthy.treat_missing_data == "breaching"
    error_message = "no data from the target group means nothing is healthy"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.llm_fallback.namespace == "BlogPlatform" && aws_cloudwatch_metric_alarm.llm_fallback.metric_name == "LlmFallback" && aws_cloudwatch_metric_alarm.llm_fallback.statistic == "Sum" && aws_cloudwatch_metric_alarm.llm_fallback.period == 900 && aws_cloudwatch_metric_alarm.llm_fallback.threshold == 10 && aws_cloudwatch_metric_alarm.llm_fallback.dimensions["Service"] == "api"
    error_message = "llm-fallback condition"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.llm_fallback.treat_missing_data == "notBreaching"
    error_message = "llm-fallback missing data"
  }
}

run "conditional_alarms_are_off_by_default" {
  command = plan

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.worker_not_running) == 0 && length(aws_cloudwatch_metric_alarm.outbox_pending) == 0
    error_message = "worker and outbox alarms only exist when their feature is on"
  }
}

run "worker_alarm" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.worker_not_running[0].alarm_actions == toset(["arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts"])
    error_message = "worker alarm notifies the ops topic"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.worker_not_running[0].namespace == "AWS/ECS" && aws_cloudwatch_metric_alarm.worker_not_running[0].metric_name == "CPUUtilization" && aws_cloudwatch_metric_alarm.worker_not_running[0].statistic == "SampleCount" && aws_cloudwatch_metric_alarm.worker_not_running[0].comparison_operator == "LessThanThreshold" && aws_cloudwatch_metric_alarm.worker_not_running[0].threshold == 1 && aws_cloudwatch_metric_alarm.worker_not_running[0].evaluation_periods == 2 && aws_cloudwatch_metric_alarm.worker_not_running[0].period == 300
    error_message = "worker-not-running condition"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.worker_not_running[0].treat_missing_data == "breaching"
    error_message = "no CPU samples means no running worker task"
  }
}

run "outbox_alarm" {
  command = plan

  variables {
    enable_worker_service = true
    enable_domain_events  = true
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.outbox_pending[0].alarm_actions == toset(["arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts"])
    error_message = "outbox alarm notifies the ops topic"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.outbox_pending[0].namespace == "BlogPlatform" && aws_cloudwatch_metric_alarm.outbox_pending[0].metric_name == "OutboxPending" && aws_cloudwatch_metric_alarm.outbox_pending[0].statistic == "Maximum" && aws_cloudwatch_metric_alarm.outbox_pending[0].threshold == 50 && aws_cloudwatch_metric_alarm.outbox_pending[0].evaluation_periods == 2 && aws_cloudwatch_metric_alarm.outbox_pending[0].period == 300 && aws_cloudwatch_metric_alarm.outbox_pending[0].dimensions["Service"] == "worker"
    error_message = "outbox-pending condition"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.outbox_pending[0].treat_missing_data == "notBreaching"
    error_message = "outbox-pending missing data"
  }
}

run "container_insights_off" {
  command = plan

  assert {
    condition     = one(aws_ecs_cluster.this.setting).value == "disabled"
    error_message = "Container Insights is disabled: the app emits its own EMF metrics (ADR-010)"
  }
}
