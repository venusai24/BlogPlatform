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

# The same three rules sit in both ACLs: the CloudFront-scoped one (only meaningful with
# edge_mode = cloudfront, T21C) and the regional one on the ALB.

run "regional_acl_on_the_alb" {
  command = plan

  variables {
    enable_waf    = true
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition     = aws_wafv2_web_acl.regional[0].scope == "REGIONAL"
    error_message = "regional scope for an ALB"
  }
  assert {
    condition     = length(aws_wafv2_web_acl_association.alb) == 1
    error_message = "the ACL is associated with the load balancer"
  }
  assert {
    condition     = length(aws_wafv2_web_acl.cloudfront) == 0
    error_message = "no CloudFront ACL when the ALB is the edge"
  }
  assert {
    condition     = length(aws_wafv2_web_acl.regional[0].rule) == 3
    error_message = "rate rule plus two managed rule groups"
  }
  assert {
    condition     = length(one(aws_wafv2_web_acl.regional[0].default_action).allow) == 1 && length(one(aws_wafv2_web_acl.regional[0].default_action).block) == 0
    error_message = "requests are allowed unless a rule blocks them"
  }
  assert {
    condition     = one(aws_wafv2_web_acl.regional[0].visibility_config).cloudwatch_metrics_enabled == true && one(aws_wafv2_web_acl.regional[0].visibility_config).sampled_requests_enabled == true
    error_message = "metrics and sampled requests on the ACL"
  }
}

run "regional_acl_rules" {
  command = plan

  variables {
    enable_waf    = true
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition = [
      for r in aws_wafv2_web_acl.regional[0].rule : r.priority if r.name == "auth-and-llm-rate"
      ] == [0] && [
      for r in aws_wafv2_web_acl.regional[0].rule : r.priority if r.name == "AWSManagedRulesCommonRuleSet"
      ] == [1] && [
      for r in aws_wafv2_web_acl.regional[0].rule : r.priority if r.name == "AWSManagedRulesKnownBadInputsRuleSet"
    ] == [2]
    error_message = "rule order: rate limit, common rules, known bad inputs"
  }
  assert {
    condition = one([
      for r in aws_wafv2_web_acl.regional[0].rule : one(r.statement).rate_based_statement if r.name == "auth-and-llm-rate"
      ])[0].limit == 300 && one([
      for r in aws_wafv2_web_acl.regional[0].rule : one(r.statement).rate_based_statement if r.name == "auth-and-llm-rate"
      ])[0].evaluation_window_sec == 300 && one([
      for r in aws_wafv2_web_acl.regional[0].rule : one(r.statement).rate_based_statement if r.name == "auth-and-llm-rate"
    ])[0].aggregate_key_type == "IP"
    error_message = "300 requests per 5 minutes per IP"
  }
  assert {
    condition = length(one([
      for r in aws_wafv2_web_acl.regional[0].rule : r.action if r.name == "auth-and-llm-rate"
    ])[0].block) == 1
    error_message = "the rate rule blocks"
  }
  assert {
    condition = toset([
      for s in one([
        for r in aws_wafv2_web_acl.regional[0].rule : one(r.statement).rate_based_statement if r.name == "auth-and-llm-rate"
      ])[0].scope_down_statement[0].or_statement[0].statement : s.byte_match_statement[0].search_string
    ]) == toset(["/auth/", "/blogs/search", "/blogs/ask", "/blogs/summarize", "/blogs/semanticSearchbyTitle"])
    error_message = "only the auth and LLM routes are rate limited"
  }
  assert {
    condition = alltrue([
      for s in one([
        for r in aws_wafv2_web_acl.regional[0].rule : one(r.statement).rate_based_statement if r.name == "auth-and-llm-rate"
      ])[0].scope_down_statement[0].or_statement[0].statement : s.byte_match_statement[0].positional_constraint == "STARTS_WITH"
    ])
    error_message = "paths are matched by prefix"
  }
  assert {
    condition = toset([
      for r in aws_wafv2_web_acl.regional[0].rule : one(one(r.statement).managed_rule_group_statement).rule_action_override[*].name if r.name == "AWSManagedRulesCommonRuleSet"
    ][0]) == toset(["SizeRestrictions_BODY"])
    error_message = "SizeRestrictions_BODY is overridden: the managed rule blocks bodies over 8 KB but the app allows posts up to 50,000 characters"
  }
  assert {
    condition = length([
      for r in aws_wafv2_web_acl.regional[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet" && try(length(r.statement[0].managed_rule_group_statement[0].rule_action_override[0].action_to_use[0].count), 0) == 1
    ]) == 1
    error_message = "the override counts instead of blocking"
  }
  assert {
    condition = alltrue([
      for r in aws_wafv2_web_acl.regional[0].rule : length(r.override_action[0].none) == 1
      if r.name != "auth-and-llm-rate"
    ])
    error_message = "managed rule groups keep their own actions"
  }
  assert {
    condition = alltrue([
      for r in aws_wafv2_web_acl.regional[0].rule : one(r.visibility_config).cloudwatch_metrics_enabled == true && one(r.visibility_config).sampled_requests_enabled == true && one(r.visibility_config).metric_name == r.name
    ])
    error_message = "every rule publishes metrics and sampled requests under its own name"
  }
}

run "cloudfront_acl" {
  command = plan

  variables {
    enable_waf = true
    edge_mode  = "cloudfront"
  }

  assert {
    condition     = aws_wafv2_web_acl.cloudfront[0].scope == "CLOUDFRONT"
    error_message = "CloudFront scope"
  }
  assert {
    condition     = length(aws_wafv2_web_acl.cloudfront[0].rule) == 3
    error_message = "the same three rules"
  }
  assert {
    condition = toset([
      for r in aws_wafv2_web_acl.cloudfront[0].rule : one(one(r.statement).managed_rule_group_statement).rule_action_override[*].name if r.name == "AWSManagedRulesCommonRuleSet"
    ][0]) == toset(["SizeRestrictions_BODY"])
    error_message = "the body-size override applies to the CloudFront ACL too"
  }
  assert {
    condition     = length(aws_wafv2_web_acl.regional) == 0 && length(aws_wafv2_web_acl_association.alb) == 0
    error_message = "no regional ACL or ALB association when CloudFront is the edge"
  }
}

run "waf_off_by_default" {
  command = plan

  variables {
    edge_mode     = "alb_https"
    domain_name   = "example.click"
    web_image_tag = "abc123"
  }

  assert {
    condition     = length(aws_wafv2_web_acl.regional) == 0 && length(aws_wafv2_web_acl.cloudfront) == 0 && length(aws_wafv2_web_acl_association.alb) == 0
    error_message = "no ACLs unless enable_waf is set"
  }
}
