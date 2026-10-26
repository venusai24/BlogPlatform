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

run "watchdog_role_is_read_only" {
  command = plan

  assert {
    condition     = aws_iam_role.session_watchdog.name == "github-actions-session-watchdog"
    error_message = "role name"
  }
  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.session_watchdog.policy).Statement : s.Action
    ])) == toset(["tag:GetResources", "ec2:DescribeNatGateways", "elasticloadbalancing:DescribeLoadBalancers"])
    error_message = "exactly the three read-only actions"
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.session_watchdog.policy).Statement : s.Effect == "Allow" && s.Resource == "*"])
    error_message = "these Describe/Get actions do not support resource-level permissions"
  }
}
