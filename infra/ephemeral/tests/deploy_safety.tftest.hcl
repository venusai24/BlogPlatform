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

run "api_rolls_back_a_bad_deployment" {
  command = plan

  assert {
    condition     = one(aws_ecs_service.api.deployment_circuit_breaker).enable == true && one(aws_ecs_service.api.deployment_circuit_breaker).rollback == true
    error_message = "a deployment that cannot stabilise rolls back automatically"
  }
}

run "api_container_has_time_to_drain" {
  command = plan

  assert {
    condition     = jsondecode(aws_ecs_task_definition.api.container_definitions)[0].stopTimeout == 30
    error_message = "SIGTERM to SIGKILL grace period matches the 25 s shutdown watchdog"
  }
}

run "target_group_drains_quickly_and_is_not_sticky" {
  command = plan

  assert {
    condition     = aws_lb_target_group.api.deregistration_delay == "30"
    error_message = "deregistration delay 30 s"
  }
  assert {
    condition     = try(one(aws_lb_target_group.api.stickiness).enabled, false) == false # HCL || does not short-circuit, so try() covers the empty list
    error_message = "no stickiness: the Socket.IO client forces the websocket transport and uses the Redis adapter"
  }
}

run "stateful_images_are_pinned" {
  command = plan

  assert {
    condition     = jsondecode(aws_ecs_task_definition.qdrant.container_definitions)[0].image == "qdrant/qdrant:v1.18.0"
    error_message = "Qdrant image is pinned to the client's minor version"
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.redis[0].container_definitions)[0].image == "redis:7.4-alpine"
    error_message = "Redis image is pinned"
  }
}

run "stateful_services_never_run_two_copies_on_one_volume" {
  command = plan

  assert {
    condition     = aws_ecs_service.redis[0].deployment_minimum_healthy_percent == 0 && aws_ecs_service.redis[0].deployment_maximum_percent == 100
    error_message = "Redis stops the old task before starting the new one (shared EFS AOF)"
  }
  assert {
    condition     = aws_ecs_service.qdrant.deployment_minimum_healthy_percent == 0 && aws_ecs_service.qdrant.deployment_maximum_percent == 100
    error_message = "Qdrant stops the old task before starting the new one (shared EFS storage)"
  }
}
