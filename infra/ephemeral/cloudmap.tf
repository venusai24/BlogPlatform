# ── Cloud Map Private DNS Namespace ──────────────────────────────────────────
resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "${var.project}.local"
  description = "Private DNS namespace for BlogPlatform services"
  vpc         = module.vpc.vpc_id
  tags        = { Name = "${local.name_prefix}-namespace" }
}

# ── Cloud Map: Redis ──────────────────────────────────────────────────────────
resource "aws_service_discovery_service" "redis" {
  count = var.redis_mode == "fargate" ? 1 : 0

  name = "redis"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ── Cloud Map: Qdrant ─────────────────────────────────────────────────────────
resource "aws_service_discovery_service" "qdrant" {
  name = "qdrant"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}
