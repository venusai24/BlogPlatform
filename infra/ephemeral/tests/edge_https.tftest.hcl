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

run "https" {
  command = plan

  variables {
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition     = aws_lb_listener.https[0].port == 443 && aws_lb_listener.https[0].protocol == "HTTPS"
    error_message = "HTTPS listener on 443"
  }
  assert {
    condition     = aws_lb_listener.https[0].ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06"
    error_message = "TLS 1.3 policy"
  }
  assert {
    condition     = aws_lb_listener.https[0].certificate_arn == "arn:aws:acm:ap-south-1:123456789012:certificate/test"
    error_message = "certificate comes from the persistent stack"
  }
  assert {
    condition     = aws_lb_listener.http.default_action[0].type == "redirect"
    error_message = "port 80 redirects to HTTPS"
  }
  assert {
    condition     = one(aws_lb_listener.http.default_action[0].redirect).port == "443" && one(aws_lb_listener.http.default_action[0].redirect).protocol == "HTTPS" && one(aws_lb_listener.http.default_action[0].redirect).status_code == "HTTP_301"
    error_message = "permanent redirect to 443"
  }
  assert {
    condition     = toset(one(aws_lb_listener_rule.api_paths[0].condition).path_pattern[0].values) == toset(["/auth/*", "/blogs", "/blogs/*"])
    error_message = "API paths go to the api target group"
  }
  assert {
    condition     = aws_lb_listener_rule.api_paths[0].priority == 10 && aws_lb_listener_rule.api_system[0].priority == 20
    error_message = "rule priorities"
  }
  assert {
    condition     = toset(one(aws_lb_listener_rule.api_system[0].condition).path_pattern[0].values) == toset(["/socket.io/*", "/health", "/ready"])
    error_message = "system paths go to the api target group"
  }
  assert {
    condition     = aws_route53_record.app[0].name == "app.example.click" && aws_route53_record.app[0].type == "A" && aws_route53_record.app[0].zone_id == "Z123"
    error_message = "app.<domain> alias record in the persistent hosted zone"
  }
  assert {
    condition     = one(aws_route53_record.app[0].alias).evaluate_target_health == true
    error_message = "alias evaluates target health"
  }
  assert {
    condition     = length(aws_s3_bucket.frontend) == 0
    error_message = "no S3 frontend bucket when nginx serves the SPA"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "CORS_ALLOWED_ORIGINS=https://app.example.click")
    error_message = "CORS allows only the app origin"
  }
}

run "https_web_service" {
  command = plan

  variables {
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition     = aws_lb_target_group.web[0].port == 8080 && aws_lb_target_group.web[0].target_type == "ip" && aws_lb_target_group.web[0].deregistration_delay == "30"
    error_message = "web target group"
  }
  assert {
    condition     = one(aws_lb_target_group.web[0].health_check).path == "/" && one(aws_lb_target_group.web[0].health_check).matcher == "200"
    error_message = "web health check"
  }
  assert {
    condition     = aws_ecs_task_definition.web[0].cpu == "256" && aws_ecs_task_definition.web[0].memory == "512"
    error_message = "web task size"
  }
  assert {
    condition     = local.web_container.image == "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-web:abc123"
    error_message = "web image is the pushed SHA"
  }
  assert {
    condition     = local.web_container.name == "web" && local.web_container.stopTimeout == 30 && local.web_container.portMappings[0].containerPort == 8080
    error_message = "web container"
  }
  assert {
    condition     = aws_ecs_service.web[0].desired_count == 1 && one(aws_ecs_service.web[0].deployment_circuit_breaker).enable == true && one(aws_ecs_service.web[0].deployment_circuit_breaker).rollback == true
    error_message = "web service count and circuit breaker"
  }
  assert {
    condition     = aws_cloudwatch_log_group.web[0].retention_in_days == 14
    error_message = "web logs kept 14 days"
  }
  assert {
    condition     = aws_security_group.web[0].name == "blogplatform-prod-web-sg"
    error_message = "web security group"
  }
}

run "https_requires_domain" {
  command = plan

  variables {
    edge_mode     = "alb_https"
    web_image_tag = "abc123"
  }

  expect_failures = [aws_lb_listener.https]
}

run "https_requires_web_image" {
  command = plan

  variables {
    edge_mode   = "alb_https"
    domain_name = "example.click"
  }

  expect_failures = [aws_lb_listener.https]
}

run "legacy_http" {
  command = plan

  assert {
    condition     = aws_lb_listener.http.default_action[0].type == "forward"
    error_message = "default edge mode forwards port 80 to the api"
  }
  assert {
    condition     = length(aws_lb_listener.https) == 0 && length(aws_ecs_service.web) == 0 && length(aws_route53_record.app) == 0
    error_message = "no HTTPS resources in the default edge mode"
  }
  assert {
    condition     = length(aws_s3_bucket.frontend) == 1
    error_message = "the S3 frontend remains for the legacy edge"
  }
  assert {
    condition     = contains([for e in local.api_environment : "${e.name}=${e.value}"], "CORS_ALLOWED_ORIGINS=*")
    error_message = "legacy edge keeps open CORS"
  }
}

run "invalid_edge_mode" {
  command = plan

  variables {
    edge_mode = "carrier_pigeon"
  }

  expect_failures = [var.edge_mode]
}
