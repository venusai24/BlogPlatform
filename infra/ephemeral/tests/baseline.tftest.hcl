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

run "baseline_plan" {
  command = plan
  assert {
    condition     = aws_ecs_service.api.desired_count == 1
    error_message = "api service must exist with desired_count 1"
  }
  assert {
    condition     = aws_lb_listener.http.port == 80
    error_message = "http listener on port 80"
  }
}

run "region_default" {
  command = plan
  assert {
    condition     = var.region == "ap-south-1"
    error_message = "region default must be ap-south-1 (ADR-016)"
  }
}

# Bedrock Converse for openai.gpt-oss-20b-1:0 is not permitted on this account,
# so the deployed API uses Groq for chat and summaries.
# Asserts on the locals feeding the task definition: the jsonencoded
# container_definitions is unknown at plan time (SQS URL, SNS ARN).
run "llm_uses_groq" {
  command = plan

  assert {
    condition     = one([for e in local.api_environment : e.value if e.name == "LLM_PROVIDER"]) == "groq"
    error_message = "LLM_PROVIDER must be groq"
  }
  assert {
    condition     = one([for e in local.api_environment : e.value if e.name == "LLM_MODEL_ID"]) == "openai/gpt-oss-20b"
    error_message = "LLM_MODEL_ID must be the Groq model id"
  }
  assert {
    condition     = one([for e in local.api_environment : e.value if e.name == "SUMMARY_PROVIDER"]) == "groq"
    error_message = "SUMMARY_PROVIDER must be groq"
  }
  assert {
    condition     = one([for e in local.api_environment : e.value if e.name == "SUMMARY_MODEL_ID"]) == "llama-3.3-70b-versatile"
    error_message = "SUMMARY_MODEL_ID must be a Groq model id"
  }
  assert {
    condition     = endswith(one([for s in local.api_secrets : s.valueFrom if s.name == "GROQ_API_KEY"]), ":parameter/blogplatform/prod/groq_api_key")
    error_message = "GROQ_API_KEY must be injected from SSM"
  }
}
