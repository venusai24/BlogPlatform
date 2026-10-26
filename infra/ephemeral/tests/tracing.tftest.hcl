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

run "tracing_off_by_default" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition     = !contains([for c in jsondecode(aws_ecs_task_definition.api.container_definitions) : c.name], "otel-collector")
    error_message = "no collector sidecar on the api when tracing is off"
  }
  assert {
    condition     = !contains([for c in local.worker_containers : c.name], "otel-collector")
    error_message = "no collector sidecar on the worker when tracing is off"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "OTEL_SDK_DISABLED=true") && contains([for e in local.api_environment : "${e.name}=${e.value}"], "OTEL_SERVICE_NAME=api")
    error_message = "the api SDK is disabled"
  }
  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "OTEL_SDK_DISABLED=true") && contains([for e in local.worker_environment : "${e.name}=${e.value}"], "OTEL_SERVICE_NAME=worker")
    error_message = "the worker SDK is disabled"
  }
  assert {
    condition     = length(local.ecs_task_policy_statements) == 2
    error_message = "no X-Ray permissions when tracing is off"
  }
}

run "tracing_on" {
  command = plan

  variables {
    enable_tracing        = true
    enable_worker_service = true
  }

  assert {
    condition     = contains([for c in jsondecode(aws_ecs_task_definition.api.container_definitions) : c.name], "otel-collector")
    error_message = "collector sidecar on the api"
  }
  assert {
    condition     = contains([for c in local.worker_containers : c.name], "otel-collector")
    error_message = "collector sidecar on the worker"
  }
  assert {
    condition = [
      for c in jsondecode(aws_ecs_task_definition.api.container_definitions) : c if c.name == "otel-collector"
    ][0].image == "public.ecr.aws/aws-observability/aws-otel-collector:v0.50.0"
    error_message = "the collector image is pinned to a release"
  }
  assert {
    condition = [
      for c in jsondecode(aws_ecs_task_definition.api.container_definitions) : c if c.name == "otel-collector"
    ][0].essential == false
    error_message = "a collector problem must not take the api down"
  }
  assert {
    condition = [
      for c in jsondecode(aws_ecs_task_definition.api.container_definitions) : c if c.name == "otel-collector"
    ][0].command == ["--config=/etc/ecs/ecs-default-config.yaml"]
    error_message = "the ECS default config forwards OTLP traces to X-Ray"
  }
  assert {
    condition = [
      for c in jsondecode(aws_ecs_task_definition.api.container_definitions) : c if c.name == "otel-collector"
    ][0].logConfiguration.options["awslogs-stream-prefix"] == "otel"
    error_message = "collector logs go to the service's log group under the otel prefix"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "OTEL_SDK_DISABLED=false") && contains([for e in local.worker_environment : "${e.name}=${e.value}"], "OTEL_SDK_DISABLED=false")
    error_message = "SDK enabled in both services"
  }
  assert {
    condition = toset([
      for s in local.ecs_task_policy_statements : s if contains(s.Action, "xray:PutTraceSegments")
    ][0].Action) == toset(["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"])
    error_message = "the task role may send traces to X-Ray"
  }
  assert {
    condition = [
      for s in local.ecs_task_policy_statements : s if contains(s.Action, "xray:PutTraceSegments")
    ][0].Resource == "*"
    error_message = "X-Ray has no resource-level permissions for these actions"
  }
}

run "tracing_preloaded_in_the_worker_command" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition     = local.worker_container.command == ["node", "-r", "./src/tracing.js", "src/worker.js"]
    error_message = "the worker preloads the tracing module"
  }
}
