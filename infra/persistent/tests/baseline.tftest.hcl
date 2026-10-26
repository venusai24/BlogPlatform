mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}
variables {
  github_repo  = "venusai24/BlogPlatform"
  budget_email = "ops@example.com"
  alert_email  = "ops@example.com"
}
run "baseline_plan" {
  command = plan
  assert {
    condition     = aws_ecr_repository.api.name == "blogplatform-api"
    error_message = "ECR repo name"
  }
}

run "region_default" {
  command = plan
  assert {
    condition     = var.region == "ap-south-1"
    error_message = "region default must be ap-south-1 (ADR-016)"
  }
}

run "groq_api_key_parameter" {
  command = plan
  assert {
    condition     = aws_ssm_parameter.groq_api_key.name == "/blogplatform/prod/groq_api_key"
    error_message = "groq_api_key SSM parameter name"
  }
  assert {
    condition     = aws_ssm_parameter.groq_api_key.type == "SecureString"
    error_message = "groq_api_key must be a SecureString"
  }
}
