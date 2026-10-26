# nginx serving the built SPA (edge_mode = alb_https). The image is pushed to the persistent
# blogplatform-web repository by CI, one immutable tag per git SHA.

locals {
  web_container = {
    name        = "web"
    image       = "${data.terraform_remote_state.persistent.outputs.web_ecr_repository_url}:${var.web_image_tag}"
    essential   = true
    stopTimeout = 30

    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:8080/ >/dev/null || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${local.name_prefix}/web"
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }
}

# No task role: the container makes no AWS calls.
resource "aws_ecs_task_definition" "web" {
  count = local.https ? 1 : 0

  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([local.web_container])
}

resource "aws_ecs_service" "web" {
  count = local.https ? 1 : 0

  name            = "${local.name_prefix}-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web[0].arn
  desired_count   = var.ha_mode ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnet_ids
    security_groups  = [aws_security_group.web[0].id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web[0].arn
    container_name   = "web"
    container_port   = 8080
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_lb_listener.https,
    aws_cloudwatch_log_group.web
  ]

  lifecycle {
    # CI registers new task definition revisions.
    ignore_changes = [task_definition]
  }
}
