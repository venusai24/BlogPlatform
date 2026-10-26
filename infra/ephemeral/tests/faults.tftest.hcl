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

run "faults_off_by_default" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition = alltrue([
      for pair in ["FAULT_INJECTION_ENABLED=false", "FAULT_EMBED_ERROR_RATE=0", "FAULT_LLM_ERROR_RATE=0", "FAULT_RELAY_PAUSE=false"] :
      contains([for e in local.api_environment : "${e.name}=${e.value}"], pair)
    ])
    error_message = "the api starts with every fault off"
  }
  assert {
    condition = alltrue([
      for pair in ["FAULT_INJECTION_ENABLED=false", "FAULT_EMBED_ERROR_RATE=0", "FAULT_LLM_ERROR_RATE=0", "FAULT_RELAY_PAUSE=false"] :
      contains([for e in local.worker_environment : "${e.name}=${e.value}"], pair)
    ])
    error_message = "the worker starts with every fault off"
  }
}

run "faults_reach_the_api_and_worker" {
  command = plan

  variables {
    enable_worker_service   = true
    fault_injection_enabled = true
    fault_embed_error_rate  = "0.5"
    fault_llm_error_rate    = "0.25"
    fault_relay_pause       = true
  }

  assert {
    condition = alltrue([
      for pair in ["FAULT_INJECTION_ENABLED=true", "FAULT_EMBED_ERROR_RATE=0.5", "FAULT_LLM_ERROR_RATE=0.25", "FAULT_RELAY_PAUSE=true"] :
      contains([for e in local.api_environment : "${e.name}=${e.value}"], pair) && contains([for e in local.worker_environment : "${e.name}=${e.value}"], pair)
    ])
    error_message = "both services see the same fault settings (production ignores them unless enabled is true)"
  }
}

run "faults_reach_the_lambda_consumer" {
  command = plan

  variables {
    enable_worker_service     = true
    enable_domain_events      = true
    indexing_consumer_runtime = "lambda"
    lambda_image_tag          = "abc123-lambda"
    fault_embed_error_rate    = "0.5"
  }

  assert {
    condition     = one(aws_lambda_function.indexing_consumer[0].environment).variables["FAULT_EMBED_ERROR_RATE"] == "0.5"
    error_message = "the Lambda embeds too, so experiment E5 must reach it"
  }
}

run "invalid_fault_rate" {
  command = plan

  variables {
    fault_embed_error_rate = "1.5"
  }

  expect_failures = [var.fault_embed_error_rate]
}

run "non_numeric_fault_rate" {
  command = plan

  variables {
    fault_llm_error_rate = "lots"
  }

  expect_failures = [var.fault_llm_error_rate]
}
