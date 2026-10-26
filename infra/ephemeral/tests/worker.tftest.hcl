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

# These assert on locals (api_environment, worker_container) because the jsonencoded
# container_definitions is unknown at plan time (SQS URL, SNS ARN).

run "worker_disabled_by_default" {
  command = plan

  assert {
    condition     = length(aws_ecs_service.worker) == 0
    error_message = "worker service must not exist by default"
  }
  assert {
    condition     = length(aws_ecs_task_definition.worker) == 0
    error_message = "worker task definition must not exist by default"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "RUN_WORKERS=true")
    error_message = "api runs the workers in-process when the worker service is off"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "SERVICE_NAME=api")
    error_message = "api SERVICE_NAME"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "MONGO_MAX_POOL_SIZE=10")
    error_message = "api Mongo pool size"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "PORT=5000")
    error_message = "api keeps its PORT"
  }
}

run "worker_enabled" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition     = one(aws_ecs_service.worker[0].capacity_provider_strategy).capacity_provider == "FARGATE_SPOT"
    error_message = "worker runs on FARGATE_SPOT"
  }
  assert {
    condition     = aws_ecs_service.worker[0].desired_count == 1
    error_message = "worker desired_count"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "RUN_WORKERS=false")
    error_message = "api hands the workers off when the worker service is on"
  }
  assert {
    condition     = local.worker_container.command == ["node", "-r", "./src/tracing.js", "src/worker.js"]
    error_message = "worker container command"
  }
  assert {
    condition     = local.worker_container.name == "worker" && local.worker_container.stopTimeout == 30
    error_message = "worker container name and stopTimeout"
  }
  assert {
    condition     = contains([for e in local.worker_container.environment : "${e.name}=${e.value}"], "SERVICE_NAME=worker") && contains([for e in local.worker_container.environment : "${e.name}=${e.value}"], "MONGO_MAX_POOL_SIZE=5")
    error_message = "worker SERVICE_NAME and Mongo pool size"
  }
  assert {
    condition     = !contains([for e in local.worker_container.environment : e.name], "PORT")
    error_message = "worker has no PORT"
  }
  assert {
    condition     = !contains(keys(local.worker_container), "portMappings") && !contains(keys(local.worker_container), "healthCheck")
    error_message = "worker has no port mappings or health check"
  }
  assert {
    condition     = local.worker_container.secrets == local.api_secrets
    error_message = "worker uses the same secrets as the api"
  }
  assert {
    condition     = length(aws_security_group_rule.worker_to_redis) == 1 && length(aws_security_group_rule.worker_to_qdrant) == 1
    error_message = "worker SG must be allowed into the internal SG on 6379 and 6333"
  }
  assert {
    condition     = aws_security_group_rule.worker_to_redis[0].from_port == 6379 && aws_security_group_rule.worker_to_qdrant[0].from_port == 6333
    error_message = "worker rule ports"
  }
}

run "api_max_capacity" {
  command = plan

  assert {
    condition     = aws_appautoscaling_target.api.max_capacity == 4
    error_message = "api max capacity is 4"
  }
}
