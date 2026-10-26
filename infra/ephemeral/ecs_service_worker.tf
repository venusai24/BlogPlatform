# Optional: run the BullMQ workers (summarize, indexing) as their own service on Fargate Spot.
# Off by default; the api then runs them in-process (RUN_WORKERS=true).

locals {
  worker_log_group_name = "/ecs/${local.name_prefix}/worker"

  worker_environment = concat(
    local.common_environment,
    [
      { name = "MONGO_MAX_POOL_SIZE", value = "5" },
      { name = "SERVICE_NAME", value = "worker" },
      { name = "OUTBOX_RELAY_ENABLED", value = var.enable_domain_events ? "true" : "false" },
      { name = "INDEXING_CONSUMER_MODE", value = var.indexing_consumer_mode },
      { name = "INDEXING_CONSUMER_RUNTIME", value = var.indexing_consumer_runtime },
      { name = "RECONCILE_INTERVAL_MS", value = var.reconcile_interval_ms },
      { name = "RECONCILE_DRY_RUN", value = var.reconcile_dry_run },
      { name = "OTEL_SDK_DISABLED", value = var.enable_tracing ? "false" : "true" },
      { name = "OTEL_SERVICE_NAME", value = "worker" }
    ]
  )

  # Same image as the api. No port mappings and no health check: nothing connects to it.
  worker_container = {
    name        = "worker"
    image       = "${local.ecr_url}:${var.api_image_tag}"
    essential   = true
    command     = ["node", "-r", "./src/tracing.js", "src/worker.js"]
    stopTimeout = 30

    environment = local.worker_environment
    secrets     = local.api_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = local.worker_log_group_name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }
}

locals {
  worker_containers = concat(
    [local.worker_container],
    var.enable_tracing ? [merge(local.otel_collector_base, {
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = local.worker_log_group_name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "otel"
        }
      }
    })] : []
  )
}

resource "aws_ecs_task_definition" "worker" {
  count = var.enable_worker_service ? 1 : 0

  family                   = "${local.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode(local.worker_containers)
}

resource "aws_ecs_service" "worker" {
  count = var.enable_worker_service ? 1 : 0

  name            = "${local.name_prefix}-worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker[0].arn
  desired_count   = var.ha_mode ? 2 : 1

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = module.vpc.private_subnet_ids
    security_groups  = [aws_security_group.worker[0].id]
    assign_public_ip = false
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.this,
    aws_cloudwatch_log_group.worker,
    aws_ecs_service.redis,
    aws_ecs_service.qdrant
  ]

  lifecycle {
    # CI registers new task definition revisions; Application Auto Scaling owns the task count.
    ignore_changes = [task_definition, desired_count]
  }
}


# Workers are safe to run side by side: outbox claims use a lease, the reconciliation sweep takes a
# Redis lock, and BullMQ distributes jobs across workers.
resource "aws_appautoscaling_target" "worker" {
  count = var.enable_worker_service ? 1 : 0

  max_capacity       = 3
  min_capacity       = var.ha_mode ? 2 : 1
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.worker[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Add workers when the indexing queue backs up.
resource "aws_appautoscaling_policy" "worker_backlog" {
  count = var.enable_worker_service && var.enable_domain_events ? 1 : 0

  name               = "${local.name_prefix}-worker-backlog-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker[0].resource_id
  scalable_dimension = aws_appautoscaling_target.worker[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker[0].service_namespace

  target_tracking_scaling_policy_configuration {
    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
      dimensions {
        name  = "QueueName"
        value = aws_sqs_queue.indexing[0].name
      }
    }
    target_value       = 20
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
