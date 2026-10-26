mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z123" }
  }
}

variables {
  github_repo  = "venusai24/BlogPlatform"
  budget_email = "ops@example.com"
  alert_email  = "ops@example.com"
}

run "with_domain" {
  command = plan

  variables {
    domain_name = "example.click"
  }

  assert {
    condition     = aws_acm_certificate.app[0].domain_name == "app.example.click"
    error_message = "certificate is for app.<domain>"
  }
  assert {
    condition     = aws_acm_certificate.app[0].validation_method == "DNS"
    error_message = "DNS validation"
  }
  assert {
    condition     = length(aws_acm_certificate_validation.app) == 1
    error_message = "the certificate is validated before it is handed to the load balancer"
  }
  assert {
    condition     = output.app_fqdn == "app.example.click" && output.hosted_zone_id == "Z123"
    error_message = "outputs for the ephemeral stack"
  }
}

run "no_domain" {
  command = plan

  variables {
    domain_name = ""
  }

  assert {
    condition     = length(aws_acm_certificate.app) == 0 && length(aws_acm_certificate_validation.app) == 0 && length(aws_route53_record.app_validation) == 0
    error_message = "no DNS or certificate resources without a domain"
  }
  assert {
    condition     = output.app_certificate_arn == null && output.hosted_zone_id == null && output.app_fqdn == null
    error_message = "outputs resolve to null so the ephemeral remote-state references still work"
  }
}

run "web_repository" {
  command = plan

  assert {
    condition     = aws_ecr_repository.web.name == "blogplatform-web"
    error_message = "web repository name"
  }
  assert {
    condition     = aws_ecr_repository.web.image_tag_mutability == "IMMUTABLE"
    error_message = "web image tags are immutable (one tag per git SHA)"
  }
  assert {
    condition     = one(aws_ecr_repository.web.image_scanning_configuration).scan_on_push == true
    error_message = "scan on push"
  }
  assert {
    condition     = aws_ecr_lifecycle_policy.web_lifecycle.repository == "blogplatform-web"
    error_message = "lifecycle policy on the web repository"
  }
}
