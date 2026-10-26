terraform {
  backend "s3" {
    key          = "ephemeral/terraform.tfstate"
    region       = "us-east-1" # bucket lives in us-east-1 (created by bootstrap)
    use_lockfile = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  required_version = ">= 1.10.0"
}

provider "aws" {
  region = var.region

  # Tags let scripts/session/status.sh find everything a session created and say how old it is.
  default_tags {
    tags = local.session_tags
  }
}

# CloudFront web ACLs can only be created in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.session_tags
  }
}

# ── Remote state: persistent layer ──────────────────────────────────────────
data "terraform_remote_state" "persistent" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "persistent/terraform.tfstate"
    region = "us-east-1" # bucket is in us-east-1 regardless of deployment region
  }
}

# ── Local helpers ────────────────────────────────────────────────────────────
locals {
  # Applied to every resource through the providers' default_tags, so scripts/session/status.sh can
  # find what a session created and say how old it is. A local so the tests can assert on it (the
  # mocked provider does not compute tags_all).
  session_tags = {
    Project = var.project
    Env     = var.env
    Layer   = "ephemeral"
    Session = var.session_started_at
  }

  name_prefix = "${var.project}-${var.env}"
  ecr_url     = data.terraform_remote_state.persistent.outputs.ecr_repository_url

  # HA mode doubles the NAT gateways, api/worker/web tasks and Valkey nodes.
  nat_gateway_count = var.ha_mode ? 2 : 1

  # TLS on the ALB with a custom domain; the SPA is served by the nginx `web` service.
  https = var.edge_mode == "alb_https"

  # Same naming convention as infra/persistent/vectors.tf, which owns the bucket.
  vector_bucket_name = "${local.name_prefix}-vectors"
  uses_s3_vectors    = var.vector_store == "s3vectors" || var.vector_store_write == "both"

  redis_elasticache = var.redis_mode == "elasticache"

  # Fargate Redis is reached through Cloud Map; ElastiCache through its primary endpoint over TLS.
  redis_scheme = local.redis_elasticache ? "rediss" : "redis"
  redis_host   = local.redis_elasticache ? aws_elasticache_replication_group.valkey[0].primary_endpoint_address : "redis.${var.project}.local"
  redis_url    = "${local.redis_scheme}://${local.redis_host}:6379"

  # Secrets are referenced by ARN built from these, never read through a decrypting data source
  # (that would put the plaintext in Terraform state).
  account_id     = data.aws_caller_identity.current.account_id
  ssm_prefix_arn = "arn:aws:ssm:${var.region}:${local.account_id}:parameter/blogplatform/${var.env}"

  # Ops alerts topic (and its confirmed email subscription) lives in the persistent stack.
  ops_alerts_topic_arn = data.terraform_remote_state.persistent.outputs.ops_alerts_topic_arn
}
