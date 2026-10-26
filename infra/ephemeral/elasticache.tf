# Managed Valkey (redis_mode = "elasticache"), replacing the Fargate Redis container.
# Node-based, because BullMQ needs maxmemory-policy noeviction and serverless does not allow it.
# Nothing durable lives here: BullMQ jobs, caches and rate-limit counters are rebuildable.

locals {
  # A local so `terraform test` can count the clients (the ids themselves are unknown at plan time).
  valkey_client_security_group_ids = concat(
    [aws_security_group.api.id],
    var.enable_worker_service ? [aws_security_group.worker[0].id] : []
  )
}

resource "random_password" "redis" {
  count = local.redis_elasticache ? 1 : 0

  length  = 32
  special = false # the token is embedded in a URL-safe context; alphanumerics avoid escaping
}

# ElastiCache requires the token in the replication group itself, so it is also in Terraform state
# (see infra/README.md). The containers read it from this parameter.
resource "aws_ssm_parameter" "redis_auth_token" {
  count = local.redis_elasticache ? 1 : 0

  name  = "/blogplatform/${var.env}/redis_auth_token"
  type  = "SecureString"
  value = random_password.redis[0].result
}

resource "aws_elasticache_subnet_group" "valkey" {
  count = local.redis_elasticache ? 1 : 0

  name       = "${local.name_prefix}-valkey"
  subnet_ids = module.vpc.private_subnet_ids
}

resource "aws_security_group" "valkey" {
  count = local.redis_elasticache ? 1 : 0

  name        = "${local.name_prefix}-valkey-sg"
  description = "Valkey reachable from the api and worker only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Valkey from api and worker"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = local.valkey_client_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-valkey-sg" }
}

# ElastiCache defaults to volatile-lru, which can silently evict queued BullMQ jobs.
resource "aws_elasticache_parameter_group" "valkey" {
  count = local.redis_elasticache ? 1 : 0

  name   = "${local.name_prefix}-valkey7-noeviction"
  family = "valkey7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "valkey" {
  count = local.redis_elasticache ? 1 : 0

  replication_group_id = "${local.name_prefix}-valkey"
  description          = "BlogPlatform queues, caches and Socket.IO adapter"

  engine               = "valkey"
  engine_version       = "7.2"
  node_type            = "cache.t4g.micro"
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.valkey[0].name

  num_cache_clusters         = var.ha_mode ? 2 : 1
  automatic_failover_enabled = var.ha_mode
  multi_az_enabled           = var.ha_mode
  snapshot_retention_limit   = 1

  subnet_group_name  = aws_elasticache_subnet_group.valkey[0].name
  security_group_ids = [aws_security_group.valkey[0].id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = random_password.redis[0].result
}
