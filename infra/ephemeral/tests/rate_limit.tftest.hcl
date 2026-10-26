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

run "rate_limiting_on_by_default" {
  command = plan

  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "RATE_LIMIT_ENABLED=true")
    error_message = "the app rate limiters stay on unless an experiment turns them off"
  }
}

run "rate_limiting_can_be_disabled_for_load_tests" {
  command = plan

  variables {
    rate_limit_enabled = false
  }

  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "RATE_LIMIT_ENABLED=false")
    error_message = "load tests from one IP need the per-IP limiters (30 searches a minute, 10 logins in 15) out of the way"
  }
}
