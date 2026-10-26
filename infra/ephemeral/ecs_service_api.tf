# Secrets are injected by ECS from SSM parameters (arn built in local.ssm_prefix_arn).
data "aws_caller_identity" "current" {}

locals {
  # Everything the api and the worker share (all of the old api environment except PORT).
  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "REDIS_TLS_ENABLED", value = local.redis_elasticache ? "true" : "false" },
    { name = "QDRANT_URL", value = "http://qdrant.${var.project}.local:6333" },
    { name = "EMBEDDING_PROVIDER", value = "bedrock" },
    { name = "EMBEDDING_MODEL_ID", value = "amazon.titan-embed-text-v2:0" },
    { name = "EMBEDDING_DIM", value = "512" },
    { name = "SUMMARY_PROVIDER", value = "groq" },
    { name = "SUMMARY_MODEL_ID", value = "llama-3.3-70b-versatile" },
    { name = "LLM_PROVIDER", value = "groq" },
    { name = "LLM_MODEL_ID", value = "openai/gpt-oss-20b" },
    # TODO(HUMAN): set from the Groq pricing page for openai/gpt-oss-20b
    { name = "LLM_PRICE_IN_PER_MTOK", value = "0" },
    { name = "LLM_PRICE_OUT_PER_MTOK", value = "0" },
    { name = "RATE_LIMIT_ENABLED", value = tostring(var.rate_limit_enabled) },
    { name = "FAULT_INJECTION_ENABLED", value = tostring(var.fault_injection_enabled) },
    { name = "FAULT_EMBED_ERROR_RATE", value = var.fault_embed_error_rate },
    { name = "FAULT_LLM_ERROR_RATE", value = var.fault_llm_error_rate },
    { name = "FAULT_RELAY_PAUSE", value = tostring(var.fault_relay_pause) },
    { name = "VECTOR_STORE", value = var.vector_store },
    { name = "VECTOR_STORE_WRITE", value = var.vector_store_write },
    { name = "S3_VECTORS_BUCKET", value = local.vector_bucket_name },
    { name = "INDEXING_BACKEND", value = var.indexing_backend },
    { name = "DOMAIN_EVENTS_TOPIC_ARN", value = try(aws_sns_topic.domain_events[0].arn, "") },
    { name = "INDEXING_QUEUE_URL", value = try(aws_sqs_queue.indexing[0].url, "") },
    { name = "ALERTS_TOPIC_ARN", value = local.ops_alerts_topic_arn },
    { name = "AWS_REGION", value = var.region }
  ]

  api_environment = concat(
    [{ name = "PORT", value = "5000" }],
    local.common_environment,
    [
      # With a separate worker service the api must not also run the workers.
      { name = "RUN_WORKERS", value = var.enable_worker_service ? "false" : "true" },
      { name = "MONGO_MAX_POOL_SIZE", value = "10" },
      { name = "SERVICE_NAME", value = "api" },
      { name = "OTEL_SDK_DISABLED", value = var.enable_tracing ? "false" : "true" },
      { name = "OTEL_SERVICE_NAME", value = "api" },
      { name = "AUTH_PROVIDER", value = var.auth_provider },
      { name = "COGNITO_USER_POOL_ID", value = var.auth_provider == "cognito" ? data.terraform_remote_state.persistent.outputs.cognito_user_pool_id : "" },
      { name = "COGNITO_CLIENT_ID", value = var.auth_provider == "cognito" ? data.terraform_remote_state.persistent.outputs.cognito_client_id : "" },
      { name = "CORS_ALLOWED_ORIGINS", value = local.https ? "https://app.${var.domain_name}" : "*" }
    ]
  )

  api_secrets = concat(
    [
      { name = "MONGODB_URI", valueFrom = "${local.ssm_prefix_arn}/mongodb_uri" },
      { name = "JWT_SECRET", valueFrom = "${local.ssm_prefix_arn}/jwt_secret" },
      { name = "QDRANT_API_KEY", valueFrom = "${local.ssm_prefix_arn}/qdrant_api_key" },
      { name = "GROQ_API_KEY", valueFrom = "${local.ssm_prefix_arn}/groq_api_key" }
    ],
    # The ElastiCache AUTH token; the app reads it as REDIS_PASSWORD.
    local.redis_elasticache ? [{ name = "REDIS_PASSWORD", valueFrom = "${local.ssm_prefix_arn}/redis_auth_token" }] : []
  )
}

locals {
  api_container = {
    name        = "api"
    image       = "${local.ecr_url}:${var.api_image_tag}"
    essential   = true
    stopTimeout = 30 # matches the 25 s graceful-shutdown watchdog in server.js

    portMappings = [{
      containerPort = 5000
      protocol      = "tcp"
    }]

    environment = local.api_environment

    secrets = local.api_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:5000/health', (r) => {if(r.statusCode !== 200) process.exit(1); else process.exit(0);}).on('error', () => process.exit(1));\" || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }

  api_containers = concat(
    [local.api_container],
    var.enable_tracing ? [merge(local.otel_collector_base, {
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "otel"
        }
      }
    })] : []
  )
}

# ── Task Definition: API ──────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode(local.api_containers)
}

# ── ECS Service: API ──────────────────────────────────────────────────────────
resource "aws_ecs_service" "api" {
  name                              = "${local.name_prefix}-api"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.ha_mode ? 2 : 1
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = module.vpc.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 5000
  }

  depends_on = [
    aws_lb_listener.http,
    aws_ecs_service.redis,
    aws_ecs_service.qdrant
  ]

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    # CI registers task definition revisions and deploys them; autoscaling owns desired_count.
    ignore_changes = [desired_count, task_definition]
  }
}

# ── Application Auto Scaling: API ─────────────────────────────────────────────
resource "aws_appautoscaling_target" "api" {
  max_capacity       = 4
  min_capacity       = var.ha_mode ? 2 : 1
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.name_prefix}-api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Scale out on load as well as CPU: 50 requests per task is well under what one task can serve, so
# a traffic spike adds tasks before CPU rises.
resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${local.name_prefix}-api-request-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.api.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
    target_value       = 50
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
