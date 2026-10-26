# Alarms that can actually fire. All notify the ops topic in the persistent stack.
# treat_missing_data is stated on every alarm: it decides what silence means.

locals {
  alb_dimensions = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name_prefix}-api-5xx"
  alarm_description   = "The API returned more than 5 server errors in 5 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching" # no traffic means no errors
  dimensions          = local.alb_dimensions
  alarm_actions       = [local.ops_alerts_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  alarm_name          = "${local.name_prefix}-api-unhealthy"
  alarm_description   = "At least one API task has failed its health check for 3 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = local.alb_dimensions
  alarm_actions       = [local.ops_alerts_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "api_no_healthy" {
  alarm_name          = "${local.name_prefix}-api-no-healthy"
  alarm_description   = "No healthy API task behind the load balancer for 3 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching" # the target group reports nothing when no task is registered
  dimensions          = local.alb_dimensions
  alarm_actions       = [local.ops_alerts_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "worker_not_running" {
  count = var.enable_worker_service ? 1 : 0

  alarm_name          = "${local.name_prefix}-worker-not-running"
  alarm_description   = "The worker service has reported no CPU samples for 10 minutes: no task is running"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "SampleCount"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.this.name
    ServiceName = aws_ecs_service.worker[0].name
  }

  alarm_actions = [local.ops_alerts_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "outbox_pending" {
  count = var.enable_domain_events ? 1 : 0

  alarm_name          = "${local.name_prefix}-outbox-pending"
  alarm_description   = "More than 50 outbox records are waiting to be published: the relay is down or stuck"
  namespace           = "BlogPlatform"
  metric_name         = "OutboxPending"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Service = "worker"
  }

  alarm_actions = [local.ops_alerts_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "llm_fallback" {
  alarm_name          = "${local.name_prefix}-llm-fallback"
  alarm_description   = "More than 10 RAG answers fell back to raw snippets in 15 minutes"
  namespace           = "BlogPlatform"
  metric_name         = "LlmFallback"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Service = "api"
  }

  alarm_actions = [local.ops_alerts_topic_arn]
}
