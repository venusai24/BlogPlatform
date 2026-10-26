# ── Task Definition: Redis ────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "redis" {
  count = var.redis_mode == "fargate" ? 1 : 0

  family                   = "${local.name_prefix}-redis"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "redis"
    image     = "redis:7.4-alpine"
    essential = true
    portMappings = [{
      containerPort = 6379
      protocol      = "tcp"
    }]
    command = ["redis-server", "--appendonly", "yes"]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.redis[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "redis"
      }
    }
    mountPoints = [{
      sourceVolume  = "redis-data"
      containerPath = "/data"
    }]
  }])

  volume {
    name = "redis-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.redis[0].id
      transit_encryption = "ENABLED"
    }
  }
}

resource "aws_ecs_service" "redis" {
  count = var.redis_mode == "fargate" ? 1 : 0

  name            = "${local.name_prefix}-redis"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.redis[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnet_ids
    security_groups  = [aws_security_group.internal.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.redis[0].arn
  }

  # One writer per EFS volume: stop the old task before starting the new one.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
}

# ── Task Definition: Qdrant ───────────────────────────────────────────────────
resource "aws_ecs_task_definition" "qdrant" {
  family                   = "${local.name_prefix}-qdrant"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "qdrant"
    image     = "qdrant/qdrant:v1.18.0" # matches @qdrant/js-client-rest 1.18.0
    essential = true
    portMappings = [{
      containerPort = 6333
      protocol      = "tcp"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.qdrant.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "qdrant"
      }
    }
    mountPoints = [{
      sourceVolume  = "qdrant-storage"
      containerPath = "/qdrant/storage"
    }]
    # Same key the api and worker send (QDRANT_API_KEY), so the vector store is not open to the VPC.
    secrets = [{
      name      = "QDRANT__SERVICE__API_KEY"
      valueFrom = "${local.ssm_prefix_arn}/qdrant_api_key"
    }]
  }])

  volume {
    name = "qdrant-storage"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.qdrant.id
      transit_encryption = "ENABLED"
    }
  }
}

resource "aws_ecs_service" "qdrant" {
  name            = "${local.name_prefix}-qdrant"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.qdrant.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnet_ids
    security_groups  = [aws_security_group.internal.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.qdrant.arn
  }

  # One writer per EFS volume: stop the old task before starting the new one.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
}
