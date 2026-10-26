mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

mock_provider "random" {}

mock_provider "aws" {
  alias = "us_east_1"
}

override_data {
  target = data.terraform_remote_state.persistent
  values = { outputs = {
    ecr_repository_url     = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-api"
    ops_alerts_topic_arn   = "arn:aws:sns:ap-south-1:123456789012:blogplatform-prod-ops-alerts"
    app_certificate_arn    = "arn:aws:acm:ap-south-1:123456789012:certificate/test"
    hosted_zone_id         = "Z123"
    nat_eip_allocation_ids = ["eipalloc-0aaa", "eipalloc-0bbb"]
    nat_eip_public_ips     = ["203.0.113.10", "203.0.113.11"]
    web_ecr_repository_url = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-web"
  } }
}

variables {
  state_bucket = "test-bucket"
}

# Values that embed the replication group's endpoint are unknown at plan time, so the URL scheme is
# asserted on a local (redis_scheme) and the TLS/password wiring on the known env entries.

run "fargate_mode_is_unchanged" {
  command = plan

  assert {
    condition     = length(aws_ecs_service.redis) == 1 && length(aws_ecs_task_definition.redis) == 1 && length(aws_efs_file_system.redis) == 1
    error_message = "the Fargate Redis stays in the default mode"
  }
  assert {
    condition     = length(aws_elasticache_replication_group.valkey) == 0 && length(aws_elasticache_parameter_group.valkey) == 0 && length(aws_ssm_parameter.redis_auth_token) == 0 && length(aws_security_group.valkey) == 0
    error_message = "no ElastiCache resources in the default mode"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "REDIS_URL=redis://redis.blogplatform.local:6379")
    error_message = "clients keep using Cloud Map DNS and plain redis://"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "REDIS_TLS_ENABLED=false")
    error_message = "no TLS to the Fargate Redis"
  }
  assert {
    condition     = !contains([for s in local.api_secrets : s.name], "REDIS_PASSWORD")
    error_message = "no Redis password in the default mode"
  }
}

run "elasticache_mode" {
  command = plan

  variables {
    redis_mode = "elasticache"
  }

  assert {
    condition     = one(aws_elasticache_parameter_group.valkey[0].parameter).name == "maxmemory-policy" && one(aws_elasticache_parameter_group.valkey[0].parameter).value == "noeviction"
    error_message = "BullMQ needs noeviction (ElastiCache defaults to volatile-lru)"
  }
  assert {
    condition     = aws_elasticache_parameter_group.valkey[0].family == "valkey7"
    error_message = "parameter group family"
  }
  assert {
    condition     = length(aws_ecs_service.redis) == 0 && length(aws_ecs_task_definition.redis) == 0 && length(aws_efs_file_system.redis) == 0 && length(aws_efs_mount_target.redis) == 0 && length(aws_service_discovery_service.redis) == 0 && length(aws_cloudwatch_log_group.redis) == 0
    error_message = "the whole Fargate Redis stack goes away"
  }
  assert {
    condition     = aws_elasticache_replication_group.valkey[0].engine == "valkey" && aws_elasticache_replication_group.valkey[0].engine_version == "7.2" && aws_elasticache_replication_group.valkey[0].node_type == "cache.t4g.micro"
    error_message = "node-based Valkey 7.2 on cache.t4g.micro"
  }
  assert {
    condition     = aws_elasticache_replication_group.valkey[0].num_cache_clusters == 1 && aws_elasticache_replication_group.valkey[0].automatic_failover_enabled == false && aws_elasticache_replication_group.valkey[0].snapshot_retention_limit == 1
    error_message = "single node, one daily snapshot"
  }
  assert {
    condition     = aws_elasticache_replication_group.valkey[0].transit_encryption_enabled == true && aws_elasticache_replication_group.valkey[0].at_rest_encryption_enabled == "true"
    error_message = "TLS in transit and encryption at rest"
  }
  assert {
    condition     = local.redis_scheme == "rediss"
    error_message = "REDIS_URL uses rediss:// (TLS)"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "REDIS_TLS_ENABLED=true")
    error_message = "clients are told to use TLS"
  }
  assert {
    condition     = [for s in local.api_secrets : s.valueFrom if s.name == "REDIS_PASSWORD"] == ["arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/redis_auth_token"]
    error_message = "the AUTH token reaches the containers as REDIS_PASSWORD from SSM"
  }
  assert {
    condition     = aws_ssm_parameter.redis_auth_token[0].name == "/blogplatform/prod/redis_auth_token" && aws_ssm_parameter.redis_auth_token[0].type == "SecureString"
    error_message = "auth token parameter"
  }
  assert {
    condition     = local.worker_container.secrets == local.api_secrets
    error_message = "the worker gets the Redis password too"
  }
  assert {
    condition     = one(aws_security_group.valkey[0].ingress).from_port == 6379 && one(aws_security_group.valkey[0].ingress).to_port == 6379
    error_message = "Valkey accepts 6379 only"
  }
}

run "elasticache_security_group_includes_the_worker" {
  command = plan

  variables {
    redis_mode            = "elasticache"
    enable_worker_service = true
  }

  assert {
    condition     = length(local.valkey_client_security_group_ids) == 2
    error_message = "api and worker security groups may reach Valkey"
  }
}

run "invalid_redis_mode" {
  command = plan

  variables {
    redis_mode = "memcached"
  }

  expect_failures = [var.redis_mode]
}
