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

run "pass_role_is_scoped_to_the_ecs_roles" {
  command = plan

  assert {
    condition = length([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "iam:PassRole")
    ][0].Resource) == 2
    error_message = "PassRole is limited to the execution and task roles"
  }
  assert {
    condition = toset([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "iam:PassRole")
      ][0].Resource) == toset([
      "arn:aws:iam::123456789012:role/blogplatform-prod-ecs-exec-role",
      "arn:aws:iam::123456789012:role/blogplatform-prod-ecs-task-role"
    ])
    error_message = "PassRole resources"
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "iam:PassRole")
    ][0].Condition.StringEquals["iam:PassedToService"] == "ecs-tasks.amazonaws.com"
    error_message = "PassRole only to ECS tasks"
  }
}

run "wildcard_resources_are_only_where_aws_requires_them" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement :
      contains(["ecr:GetAuthorizationToken", "ecs:DescribeTaskDefinition,ecs:RegisterTaskDefinition"], join(",", sort(s.Action)))
      if s.Resource == "*"
    ])
    error_message = "only GetAuthorizationToken and the task definition actions may use Resource \"*\""
  }
  assert {
    condition = length([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s if s.Resource == "*"
    ]) == 2
    error_message = "exactly two wildcard statements"
  }
}

run "ecr_push_is_limited_to_the_two_repositories" {
  command = plan

  assert {
    condition = toset([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "ecr:PutImage")
      ][0].Resource) == toset([
      "arn:aws:ecr:ap-south-1:123456789012:repository/blogplatform-api",
      "arn:aws:ecr:ap-south-1:123456789012:repository/blogplatform-web"
    ])
    error_message = "push to the api and web repositories only"
  }
}

run "ecs_service_actions_are_limited_to_the_cluster" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "ecs:UpdateService")
    ][0].Resource == "arn:aws:ecs:ap-south-1:123456789012:service/blogplatform-prod-cluster/*"
    error_message = "UpdateService/DescribeServices only on this cluster's services"
  }
}

run "s3_and_cloudfront_are_scoped" {
  command = plan

  assert {
    condition = toset([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "s3:PutObject")
    ][0].Resource) == toset(["arn:aws:s3:::blogplatform-prod-frontend-*", "arn:aws:s3:::blogplatform-prod-frontend-*/*"])
    error_message = "S3 access only to the frontend buckets"
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "cloudfront:CreateInvalidation")
    ][0].Resource == "arn:aws:cloudfront::123456789012:distribution/*"
    error_message = "CloudFront invalidation on distributions in this account"
  }
}

run "ci_may_update_only_the_indexing_consumer_function" {
  command = plan

  assert {
    condition = toset([
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "lambda:UpdateFunctionCode")
    ][0].Action) == toset(["lambda:UpdateFunctionCode", "lambda:GetFunction"])
    error_message = "update the code and read the function, nothing else"
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.github_actions.policy).Statement : s
      if contains(s.Action, "lambda:UpdateFunctionCode")
    ][0].Resource == "arn:aws:lambda:ap-south-1:123456789012:function:blogplatform-prod-indexing-consumer"
    error_message = "one function only"
  }
}

# GitHub can issue `sub` with immutable owner and repository ids
# (repo:<owner>@<owner id>/<repo>@<repo id>:ref:...); the trust must match that form when it is set.
run "trust_accepts_the_name_form_by_default" {
  command = plan

  assert {
    condition = toset(local.github_oidc_subjects) == toset([
      "repo:venusai24/BlogPlatform:ref:refs/heads/main"
    ])
    error_message = "both roles trust only main of github_repo"
  }
}

run "trust_also_accepts_the_immutable_id_form" {
  command = plan

  variables {
    github_repo_id_subject = "venusai24@61750975/BlogPlatform@1424005764"
  }

  assert {
    condition = toset(local.github_oidc_subjects) == toset([
      "repo:venusai24/BlogPlatform:ref:refs/heads/main",
      "repo:venusai24@61750975/BlogPlatform@1424005764:ref:refs/heads/main"
    ])
    error_message = "both roles trust both subject forms for main"
  }
}

run "id_subject_must_have_both_ids" {
  command = plan

  variables {
    github_repo_id_subject = "venusai24/BlogPlatform"
  }

  expect_failures = [var.github_repo_id_subject]
}
