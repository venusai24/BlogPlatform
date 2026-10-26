data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

resource "aws_iam_role" "github_actions" {
  name = "github-actions-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = local.github_oidc_subjects
          }
        }
      }
    ]
  })
}

locals {
  account_id = data.aws_caller_identity.current.account_id

  # Only runs on main may assume the CI roles. GitHub writes the repository either by name or, for
  # repositories that use immutable ids, as owner@id/repo@id; both forms are trusted when the second is set.
  github_oidc_subjects = compact([
    "repo:${var.github_repo}:ref:refs/heads/main",
    var.github_repo_id_subject == null ? "" : "repo:${var.github_repo_id_subject}:ref:refs/heads/main"
  ])

  # Constructed (not aws_*.arn) so the policy is fully known at plan time.
  ecr_repository_arns = [
    "arn:aws:ecr:${var.region}:${local.account_id}:repository/blogplatform-api",
    "arn:aws:ecr:${var.region}:${local.account_id}:repository/blogplatform-web"
  ]
}

resource "aws_iam_role_policy" "github_actions" {
  name = "github-actions-deploy-policy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*" # GetAuthorizationToken has no resource-level permissions
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:GetRepositoryPolicy",
          "ecr:DescribeRepositories",
          "ecr:ListImages",
          "ecr:DescribeImages",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage"
        ]
        Resource = local.ecr_repository_arns
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "arn:aws:ecs:${var.region}:${local.account_id}:service/blogplatform-${var.env}-cluster/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:DescribeTaskDefinition"
        ]
        Resource = "*" # no resource-level permissions for these actions
      },
      {
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          "arn:aws:iam::${local.account_id}:role/blogplatform-${var.env}-ecs-exec-role",
          "arn:aws:iam::${local.account_id}:role/blogplatform-${var.env}-ecs-task-role"
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "arn:aws:s3:::blogplatform-${var.env}-frontend-*",
          "arn:aws:s3:::blogplatform-${var.env}-frontend-*/*"
        ]
      },
      {
        # CI may swap the code of the one indexing-consumer function, nothing else about Lambda.
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction"
        ]
        Resource = "arn:aws:lambda:${var.region}:${local.account_id}:function:blogplatform-${var.env}-indexing-consumer"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = "arn:aws:cloudfront::${local.account_id}:distribution/*"
      }
    ]
  })
}

# Read-only role for the daily session watchdog workflow: it can see what is running, never change it.
resource "aws_iam_role" "session_watchdog" {
  name = "github-actions-session-watchdog"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = local.github_oidc_subjects
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "session_watchdog" {
  name = "session-watchdog-policy"
  role = aws_iam_role.session_watchdog.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "tag:GetResources",
          "ec2:DescribeNatGateways",
          "elasticloadbalancing:DescribeLoadBalancers"
        ]
        Resource = "*" # these read-only actions have no resource-level permissions
      }
    ]
  })
}

output "session_watchdog_role_arn" {
  description = "Set as the AWS_READONLY_ROLE_ARN repository secret for the session-watchdog workflow"
  value       = aws_iam_role.session_watchdog.arn
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}
