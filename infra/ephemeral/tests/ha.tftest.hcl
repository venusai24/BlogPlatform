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

run "standard" {
  command = plan

  assert {
    condition     = length(module.vpc.nat_gateway_ids) == 1
    error_message = "one NAT gateway in the standard topology"
  }
  assert {
    condition     = length(module.vpc.private_route_table_ids) == 2
    error_message = "one private route table per AZ, both routed through the single NAT"
  }
  assert {
    condition     = aws_ecs_service.api.desired_count == 1 && aws_appautoscaling_target.api.min_capacity == 1 && aws_appautoscaling_target.api.max_capacity == 4
    error_message = "one api task, scaling up to 4"
  }
  assert {
    condition     = output.nat_public_ips == ["203.0.113.10"]
    error_message = "only the first EIP is in use, so only it needs to be in the Atlas allowlist"
  }
}

run "ha" {
  command = plan

  variables {
    ha_mode    = true
    redis_mode = "elasticache"
  }

  assert {
    condition     = length(module.vpc.nat_gateway_ids) == 2
    error_message = "a NAT gateway per AZ"
  }
  assert {
    condition     = aws_appautoscaling_target.api.min_capacity == 2 && aws_appautoscaling_target.api.max_capacity == 4
    error_message = "two api tasks minimum"
  }
  assert {
    condition     = aws_ecs_service.api.desired_count == 2
    error_message = "api desired count"
  }
  assert {
    condition     = aws_elasticache_replication_group.valkey[0].num_cache_clusters == 2 && aws_elasticache_replication_group.valkey[0].automatic_failover_enabled == true && aws_elasticache_replication_group.valkey[0].multi_az_enabled == true
    error_message = "Valkey primary plus replica with automatic multi-AZ failover"
  }
  assert {
    condition     = output.nat_public_ips == ["203.0.113.10", "203.0.113.11"]
    error_message = "both EIPs are in use, so both need to be in the Atlas allowlist"
  }
}

run "request_count_scaling" {
  command = plan

  assert {
    condition     = aws_appautoscaling_policy.api_requests.policy_type == "TargetTrackingScaling"
    error_message = "target tracking"
  }
  assert {
    condition     = one(aws_appautoscaling_policy.api_requests.target_tracking_scaling_policy_configuration).target_value == 50
    error_message = "50 requests per target"
  }
  assert {
    condition     = one(one(aws_appautoscaling_policy.api_requests.target_tracking_scaling_policy_configuration).predefined_metric_specification).predefined_metric_type == "ALBRequestCountPerTarget"
    error_message = "scale on ALB requests per target"
  }
  assert {
    condition     = one(aws_appautoscaling_policy.api_requests.target_tracking_scaling_policy_configuration).scale_out_cooldown == 60 && one(aws_appautoscaling_policy.api_requests.target_tracking_scaling_policy_configuration).scale_in_cooldown == 300
    error_message = "cooldowns 60 s out, 300 s in"
  }
}

run "worker_scaling_in_ha" {
  command = plan

  variables {
    ha_mode               = true
    enable_worker_service = true
    enable_domain_events  = true
  }

  assert {
    condition     = aws_ecs_service.worker[0].desired_count == 2
    error_message = "two workers in HA mode"
  }
  assert {
    condition     = aws_appautoscaling_target.worker[0].min_capacity == 2 && aws_appautoscaling_target.worker[0].max_capacity == 3
    error_message = "worker scales 2..3"
  }
  assert {
    condition     = one(aws_appautoscaling_policy.worker_backlog[0].target_tracking_scaling_policy_configuration).target_value == 20
    error_message = "about 20 visible messages per worker"
  }
  assert {
    condition     = one(one(aws_appautoscaling_policy.worker_backlog[0].target_tracking_scaling_policy_configuration).customized_metric_specification).metric_name == "ApproximateNumberOfMessagesVisible" && one(one(aws_appautoscaling_policy.worker_backlog[0].target_tracking_scaling_policy_configuration).customized_metric_specification).namespace == "AWS/SQS" && one(one(aws_appautoscaling_policy.worker_backlog[0].target_tracking_scaling_policy_configuration).customized_metric_specification).statistic == "Average"
    error_message = "queue backlog drives the worker count"
  }
}

run "worker_scaling_only_with_a_worker" {
  command = plan

  assert {
    condition     = length(aws_appautoscaling_target.worker) == 0 && length(aws_appautoscaling_policy.worker_backlog) == 0
    error_message = "no worker scaling without a worker service"
  }
}

run "worker_standard" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition     = aws_ecs_service.worker[0].desired_count == 1 && aws_appautoscaling_target.worker[0].min_capacity == 1
    error_message = "one worker outside HA mode"
  }
  assert {
    condition     = length(aws_appautoscaling_policy.worker_backlog) == 0
    error_message = "no backlog policy without domain events (no queue to measure)"
  }
}

run "web_in_ha" {
  command = plan

  variables {
    ha_mode       = true
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition     = aws_ecs_service.web[0].desired_count == 2
    error_message = "two web tasks in HA mode"
  }
}
