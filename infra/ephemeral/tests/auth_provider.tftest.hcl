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
    cognito_user_pool_id   = "ap-south-1_abc123"
    cognito_client_id      = "client-1"
    nat_eip_public_ips     = ["203.0.113.10", "203.0.113.11"]
    web_ecr_repository_url = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-web"
  } }
}

variables {
  state_bucket = "test-bucket"
}

run "app_auth_by_default" {
  command = plan

  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "AUTH_PROVIDER=app")
    error_message = "the API issues its own tokens unless Cognito is switched on"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "COGNITO_USER_POOL_ID=") && contains([for e in local.api_environment : "${e.name}=${e.value}"], "COGNITO_CLIENT_ID=")
    error_message = "no Cognito settings in app mode"
  }
}

run "cognito_auth" {
  command = plan

  variables {
    auth_provider = "cognito"
  }

  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "AUTH_PROVIDER=cognito") && contains([for e in local.api_environment : "${e.name}=${e.value}"], "COGNITO_USER_POOL_ID=ap-south-1_abc123") && contains([for e in local.api_environment : "${e.name}=${e.value}"], "COGNITO_CLIENT_ID=client-1")
    error_message = "the API verifies tokens for the pool and client in the persistent stack"
  }
}

run "invalid_auth_provider" {
  command = plan

  variables {
    auth_provider = "okta"
  }

  expect_failures = [var.auth_provider]
}
