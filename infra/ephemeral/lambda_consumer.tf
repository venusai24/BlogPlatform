# The indexing consumer as a Lambda function (indexing_consumer_runtime = "lambda") instead of the
# worker polling the queue. Same handler logic; the SQS event source mapping does the polling.
# Only one runtime consumes at a time: with "lambda" the worker skips its poller.

locals {
  use_lambda = var.enable_domain_events && var.indexing_consumer_runtime == "lambda"

  lambda_consumer_name = "${local.name_prefix}-indexing-consumer"

  # Non-secret settings shared with the containers. AWS_REGION is reserved by Lambda (it sets it
  # itself), so it must not be passed. The handler reads the secrets from SSM.
  lambda_consumer_environment = merge(
    { for e in local.common_environment : e.name => e.value if e.name != "AWS_REGION" },
    {
      APP_ENV                = var.env
      NODE_ENV               = "production"
      PORT                   = "0"
      MONGO_MAX_POOL_SIZE    = "2" # 2 concurrent invocations x pool 2 stays well under Atlas M0's connection limit
      SERVICE_NAME           = "indexing-lambda"
      INDEXING_CONSUMER_MODE = var.indexing_consumer_mode
    }
  )

  lambda_consumer_policy_statements = concat(
    [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes"
        ]
        Resource = try(aws_sqs_queue.indexing[0].arn, "")
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = "${local.ssm_prefix_arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = ["arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"]
      }
    ],
    local.s3vectors_statements
  )
}

resource "aws_iam_role" "lambda_consumer" {
  count = local.use_lambda ? 1 : 0

  name = "${local.lambda_consumer_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Network interfaces for running inside the VPC, plus CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "lambda_consumer_vpc" {
  count = local.use_lambda ? 1 : 0

  role       = aws_iam_role.lambda_consumer[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_consumer" {
  count = local.use_lambda ? 1 : 0

  name = "${local.lambda_consumer_name}-policy"
  role = aws_iam_role.lambda_consumer[0].id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.lambda_consumer_policy_statements
  })
}

resource "aws_security_group" "lambda_consumer" {
  count = local.use_lambda ? 1 : 0

  name        = "${local.lambda_consumer_name}-sg"
  description = "Indexing consumer function: egress only"
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.lambda_consumer_name}-sg" }
}

# Qdrant is reached over the VPC; S3 Vectors, Bedrock, SSM and Atlas go out through the NAT.
resource "aws_security_group_rule" "qdrant_from_lambda_consumer" {
  count = local.use_lambda && (var.vector_store == "qdrant" || var.vector_store_write == "both") ? 1 : 0

  type                     = "ingress"
  description              = "Qdrant HTTP from the indexing consumer function"
  from_port                = 6333
  to_port                  = 6333
  protocol                 = "tcp"
  security_group_id        = aws_security_group.internal.id
  source_security_group_id = aws_security_group.lambda_consumer[0].id
}

resource "aws_cloudwatch_log_group" "lambda_consumer" {
  count = local.use_lambda ? 1 : 0

  name              = "/aws/lambda/${local.lambda_consumer_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "indexing_consumer" {
  count = local.use_lambda ? 1 : 0

  function_name = local.lambda_consumer_name
  role          = aws_iam_role.lambda_consumer[0].arn
  package_type  = "Image"
  image_uri     = "${local.ecr_url}:${var.lambda_image_tag}"
  timeout       = 60
  memory_size   = 512

  vpc_config {
    subnet_ids         = module.vpc.private_subnet_ids
    security_group_ids = [aws_security_group.lambda_consumer[0].id]
  }

  environment {
    variables = local.lambda_consumer_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda_consumer,
    aws_iam_role_policy_attachment.lambda_consumer_vpc,
    aws_iam_role_policy.lambda_consumer
  ]

  lifecycle {
    precondition {
      condition     = var.lambda_image_tag != ""
      error_message = "indexing_consumer_runtime = lambda requires lambda_image_tag (the <git sha>-lambda image CI pushed)"
    }
    # CI updates the code with `aws lambda update-function-code`.
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_event_source_mapping" "indexing" {
  count = local.use_lambda ? 1 : 0

  event_source_arn                   = aws_sqs_queue.indexing[0].arn
  function_name                      = aws_lambda_function.indexing_consumer[0].arn
  enabled                            = var.indexing_consumer_mode != "off"
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 2
  }
}
