# AWS WAF in front of the app (enable_waf). Off by default; turn it on for sessions.
#
# One ACL, in the scope that matches the edge:
#   - alb_http / alb_https: a REGIONAL ACL associated with the load balancer.
#   - cloudfront (T21C): a CLOUDFRONT ACL, which must be created in us-east-1.
# The two ACLs carry the same rules, so they are written out twice rather than behind a module
# (the tests address the resources directly). Watch the sampled requests during the first session:
# a managed rule can block legitimate traffic.

locals {
  waf_regional   = var.enable_waf && var.edge_mode != "cloudfront"
  waf_cloudfront = var.enable_waf && var.edge_mode == "cloudfront"

  # Routes that hit the database, the embedding model or the LLM, or guess passwords.
  waf_rate_limited_paths = toset(["/auth/", "/blogs/search", "/blogs/ask", "/blogs/summarize", "/blogs/semanticSearchbyTitle"])
}

resource "aws_wafv2_web_acl" "regional" {
  count = local.waf_regional ? 1 : 0

  name        = "${local.name_prefix}-waf-regional"
  description = "Edge protection for the BlogPlatform API"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # 1. Rate limit the expensive and abuse-prone routes per client IP.
  rule {
    name     = "auth-and-llm-rate"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = 300
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"

        scope_down_statement {
          or_statement {
            dynamic "statement" {
              for_each = local.waf_rate_limited_paths
              content {
                byte_match_statement {
                  search_string         = statement.value
                  positional_constraint = "STARTS_WITH"

                  field_to_match {
                    uri_path {}
                  }

                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
      metric_name                = "auth-and-llm-rate"
    }
  }

  # 2. AWS common rules. SizeRestrictions_BODY would block request bodies over 8 KB, but the app
  #    accepts posts of up to 50,000 characters (T09), so that one rule only counts.
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
      metric_name                = "AWSManagedRulesCommonRuleSet"
    }
  }

  # 3. Known exploit payloads (Log4j, etc.).
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSet"
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = true
    metric_name                = "${local.name_prefix}-waf-regional"
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  count = local.waf_regional ? 1 : 0

  resource_arn = aws_lb.api.arn
  web_acl_arn  = aws_wafv2_web_acl.regional[0].arn
}

resource "aws_wafv2_web_acl" "cloudfront" {
  count    = local.waf_cloudfront ? 1 : 0
  provider = aws.us_east_1

  name        = "${local.name_prefix}-waf-cloudfront"
  description = "Edge protection for the BlogPlatform API"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # 1. Rate limit the expensive and abuse-prone routes per client IP.
  rule {
    name     = "auth-and-llm-rate"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = 300
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"

        scope_down_statement {
          or_statement {
            dynamic "statement" {
              for_each = local.waf_rate_limited_paths
              content {
                byte_match_statement {
                  search_string         = statement.value
                  positional_constraint = "STARTS_WITH"

                  field_to_match {
                    uri_path {}
                  }

                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
      metric_name                = "auth-and-llm-rate"
    }
  }

  # 2. AWS common rules. SizeRestrictions_BODY would block request bodies over 8 KB, but the app
  #    accepts posts of up to 50,000 characters (T09), so that one rule only counts.
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
      metric_name                = "AWSManagedRulesCommonRuleSet"
    }
  }

  # 3. Known exploit payloads (Log4j, etc.).
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSet"
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = true
    metric_name                = "${local.name_prefix}-waf-cloudfront"
  }
}
