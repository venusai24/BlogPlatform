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

run "resources_are_tagged_with_the_session" {
  command = plan

  variables {
    session_started_at = "2026-10-16T08:00:00Z"
  }

  assert {
    condition     = local.session_tags["Layer"] == "ephemeral" && local.session_tags["Session"] == "2026-10-16T08:00:00Z"
    error_message = "every ephemeral resource carries Layer and Session, so the watchdog can find and date a session"
  }
  assert {
    condition     = local.session_tags["Project"] == "blogplatform" && local.session_tags["Env"] == "prod"
    error_message = "Project and Env tags"
  }
}

run "session_tag_defaults_to_unset" {
  command = plan

  assert {
    condition     = local.session_tags["Session"] == "unset"
    error_message = "an apply that skips the session tooling is visible as Session=unset"
  }
}

run "tooling_outputs" {
  command = plan

  assert {
    condition     = length(output.private_subnet_ids) == 2
    error_message = "the reconcile task needs the private subnets"
  }
  # api_url is "http://<ALB DNS name>" outside the HTTPS edge; the DNS name is unknown at plan time,
  # so only the HTTPS form below can be asserted exactly.
}

run "api_url_over_https" {
  command = plan

  variables {
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition     = output.api_url == "https://app.example.click"
    error_message = "api_url follows the HTTPS edge"
  }
}

run "worker_security_group_output" {
  command = plan

  variables {
    enable_worker_service = true
  }

  assert {
    condition     = length(aws_security_group.worker) == 1
    error_message = "the worker security group exists, so the output carries its id for the one-off reconcile task"
  }
}
