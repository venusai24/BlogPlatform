# ── ECS Cluster ───────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "this" {
  name = "${local.name_prefix}-cluster"

  setting {
    name = "containerInsights"
    # Off: the app emits its own EMF metrics (ADR-010); Container Insights is billed per task and metric.
    value = "disabled"
  }

  tags = { Name = "${local.name_prefix}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── IAM: Task Execution Role (pull image, write logs, read SSM) ───────────────
resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_exec_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Secrets are injected from SSM only. SecureString parameters use the AWS-managed aws/ssm key,
# whose key policy already lets SSM-authorised principals in this account decrypt, so no kms:Decrypt.
resource "aws_iam_role_policy" "ecs_exec_ssm" {
  name = "${local.name_prefix}-ecs-exec-ssm"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters"]
      Resource = "${local.ssm_prefix_arn}/*"
    }]
  })
}

# ── IAM: Task Role (SQS, Bedrock, S3) ────────────────────────────────────────
resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

locals {
  # The bucket and indexes already exist (persistent stack), so no Create* actions. Shared by the ECS
  # task role and the Lambda consumer role.
  s3vectors_statements = local.uses_s3_vectors ? [
    {
      Effect = "Allow"
      Action = [
        "s3vectors:GetIndex",
        "s3vectors:PutVectors",
        "s3vectors:DeleteVectors",
        "s3vectors:QueryVectors",
        "s3vectors:GetVectors",
        "s3vectors:ListVectors"
      ]
      Resource = [
        "arn:aws:s3vectors:${var.region}:${local.account_id}:bucket/${local.vector_bucket_name}",
        "arn:aws:s3vectors:${var.region}:${local.account_id}:bucket/${local.vector_bucket_name}/index/*"
      ]
    }
  ] : []

  # A local so `terraform test` can count the statements (the encoded policy embeds unknown ARNs).
  ecs_task_policy_statements = concat(
    [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = local.ops_alerts_topic_arn
      },
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0",
          "arn:aws:bedrock:${var.region}::foundation-model/openai.gpt-oss-20b-1:0"
        ]
      }
    ],
    local.s3vectors_statements,
    # X-Ray has no resource-level permissions for these actions.
    var.enable_tracing ? [
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets"
        ]
        Resource = "*"
      }
    ] : [],
    var.enable_domain_events ? [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.domain_events[0].arn
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.indexing[0].arn
      }
    ] : []
  )
}

resource "aws_iam_role_policy" "ecs_task_permissions" {
  name = "${local.name_prefix}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.ecs_task_policy_statements
  })
}

# ── CloudWatch Log Groups ─────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}/api"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "worker" {
  count = var.enable_worker_service ? 1 : 0

  name              = local.worker_log_group_name
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "web" {
  count = local.https ? 1 : 0

  name              = "/ecs/${local.name_prefix}/web"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "redis" {
  count = var.redis_mode == "fargate" ? 1 : 0

  name              = "/ecs/${local.name_prefix}/redis"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "qdrant" {
  name              = "/ecs/${local.name_prefix}/qdrant"
  retention_in_days = 7
}
