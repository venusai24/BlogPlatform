# Domain events (ADR-001): the outbox relay publishes to an SNS topic, which fans out to SQS queues.
# Only the indexing queue exists today. All resources are off unless enable_domain_events is set.

locals {
  # Kept as locals so `terraform test` can assert on them: the encoded policies embed ARNs that are
  # unknown at plan time.
  indexing_redrive_policy = {
    deadLetterTargetArn = try(aws_sqs_queue.indexing_dlq[0].arn, "")
    maxReceiveCount     = 5
  }

  indexing_filter_policy = {
    eventType = [{ prefix = "blog.post." }]
  }
}

resource "aws_sns_topic" "domain_events" {
  count = var.enable_domain_events ? 1 : 0

  name              = "${local.name_prefix}-domain-events"
  kms_master_key_id = "alias/aws/sns"

  lifecycle {
    precondition {
      condition     = var.enable_worker_service
      error_message = "enable_domain_events requires enable_worker_service"
    }
  }
}

resource "aws_sqs_queue" "indexing_dlq" {
  count = var.enable_domain_events ? 1 : 0

  name                      = "${local.name_prefix}-indexing-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true

  tags = { Name = "${local.name_prefix}-indexing-dlq" }
}

resource "aws_sqs_queue" "indexing" {
  count = var.enable_domain_events ? 1 : 0

  name = "${local.name_prefix}-indexing"
  # Lambda: at least 6x the function timeout (AWS guidance for SQS event sources).
  visibility_timeout_seconds = local.use_lambda ? 360 : 120
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 20     # long polling
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode(local.indexing_redrive_policy)

  tags = { Name = "${local.name_prefix}-indexing" }
}

# Only the indexing queue may use this DLQ.
resource "aws_sqs_queue_redrive_allow_policy" "indexing_dlq" {
  count = var.enable_domain_events ? 1 : 0

  queue_url = aws_sqs_queue.indexing_dlq[0].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.indexing[0].arn]
  })
}

# Let the topic (and only the topic) deliver into the queue.
resource "aws_sqs_queue_policy" "indexing" {
  count = var.enable_domain_events ? 1 : 0

  queue_url = aws_sqs_queue.indexing[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowDomainEventsTopic"
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.indexing[0].arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_sns_topic.domain_events[0].arn }
      }
    }]
  })
}

resource "aws_sns_topic_subscription" "indexing" {
  count = var.enable_domain_events ? 1 : 0

  topic_arn            = aws_sns_topic.domain_events[0].arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.indexing[0].arn
  raw_message_delivery = true
  filter_policy_scope  = "MessageAttributes"
  filter_policy        = jsonencode(local.indexing_filter_policy)
}

# ── Alarms (notify the ops topic in the persistent stack) ────────────────────
resource "aws_cloudwatch_metric_alarm" "indexing_dlq_depth" {
  count = var.enable_domain_events ? 1 : 0

  alarm_name          = "${local.name_prefix}-indexing-dlq-depth"
  alarm_description   = "Messages reached the indexing DLQ: an event failed 5 times"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.indexing_dlq[0].name
  }

  alarm_actions = [local.ops_alerts_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "indexing_age" {
  count = var.enable_domain_events ? 1 : 0

  alarm_name          = "${local.name_prefix}-indexing-queue-age"
  alarm_description   = "The oldest indexing message has waited over 10 minutes: the consumer is stuck or down"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 600
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.indexing[0].name
  }

  alarm_actions = [local.ops_alerts_topic_arn]
}
