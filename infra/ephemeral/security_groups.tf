# ── Security Group: ALB ──────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Allow HTTP from internet into ALB"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb-sg" }
}

# ── Security Group: ECS API ───────────────────────────────────────────────────
resource "aws_security_group" "api" {
  name        = "${local.name_prefix}-api-sg"
  description = "Allow traffic from ALB into API containers"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "From ALB"
    from_port       = 5000
    to_port         = 5000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-api-sg" }
}

# ── Security Group: internal services (Redis, Qdrant) ────────────────────────
resource "aws_security_group" "internal" {
  name        = "${local.name_prefix}-internal-sg"
  description = "Redis and Qdrant reachable only from API SG"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis from API"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  ingress {
    description     = "Qdrant HTTP from API"
    from_port       = 6333
    to_port         = 6333
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-internal-sg" }
}

# ── Security Group: ECS worker (only when the worker service is enabled) ─────
resource "aws_security_group" "worker" {
  count = var.enable_worker_service ? 1 : 0

  name        = "${local.name_prefix}-worker-sg"
  description = "Worker containers: no ingress, egress to Redis, Qdrant and the internet"
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-worker-sg" }
}

resource "aws_security_group_rule" "worker_to_redis" {
  count = var.enable_worker_service && var.redis_mode == "fargate" ? 1 : 0

  type                     = "ingress"
  description              = "Redis from worker"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.internal.id
  source_security_group_id = aws_security_group.worker[0].id
}

resource "aws_security_group_rule" "worker_to_qdrant" {
  count = var.enable_worker_service ? 1 : 0

  type                     = "ingress"
  description              = "Qdrant HTTP from worker"
  from_port                = 6333
  to_port                  = 6333
  protocol                 = "tcp"
  security_group_id        = aws_security_group.internal.id
  source_security_group_id = aws_security_group.worker[0].id
}

# ── Security Group: ECS web (nginx serving the SPA) ──────────────────────────
resource "aws_security_group" "web" {
  count = local.https ? 1 : 0

  name        = "${local.name_prefix}-web-sg"
  description = "Allow traffic from the ALB into the nginx web containers"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "From ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-web-sg" }
}
