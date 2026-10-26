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

run "execution_role_reads_only_the_app_parameters" {
  command = plan

  assert {
    condition     = length(jsondecode(aws_iam_role_policy.ecs_exec_ssm.policy).Statement) == 1
    error_message = "a single statement: no Secrets Manager, no KMS"
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_exec_ssm.policy).Statement[0].Resource == "arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/*"
    error_message = "the execution role may only read parameters under /blogplatform/<env>/"
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_exec_ssm.policy).Statement[0].Action == ["ssm:GetParameters"]
    error_message = "ssm:GetParameters is the only action ECS needs to inject secrets"
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.ecs_exec_ssm.policy, "secretsmanager:GetSecretValue") && !strcontains(aws_iam_role_policy.ecs_exec_ssm.policy, "kms:Decrypt")
    error_message = "secretsmanager:GetSecretValue and kms:Decrypt are gone"
  }
}

run "task_role_bedrock_is_model_scoped" {
  command = plan

  assert {
    condition = length([
      for s in jsondecode(aws_iam_role_policy.ecs_task_permissions.policy).Statement : s
      if contains(s.Action, "bedrock:InvokeModel")
    ][0].Resource) == 2
    error_message = "Bedrock access is limited to two foundation models"
  }
  assert {
    condition = toset([
      for s in jsondecode(aws_iam_role_policy.ecs_task_permissions.policy).Statement : s
      if contains(s.Action, "bedrock:InvokeModel")
      ][0].Resource) == toset([
      "arn:aws:bedrock:ap-south-1::foundation-model/amazon.titan-embed-text-v2:0",
      "arn:aws:bedrock:ap-south-1::foundation-model/openai.gpt-oss-20b-1:0"
    ])
    error_message = "the Titan embedding model and the shelved gpt-oss model"
  }
}

run "secrets_are_referenced_by_constructed_arn" {
  command = plan

  assert {
    condition = { for s in local.api_secrets : s.name => s.valueFrom } == {
      MONGODB_URI    = "arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/mongodb_uri"
      JWT_SECRET     = "arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/jwt_secret"
      QDRANT_API_KEY = "arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/qdrant_api_key"
      GROQ_API_KEY   = "arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/groq_api_key"
    }
    error_message = "api and worker secrets come from arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod parameters by constructed ARN, not from decrypting data sources"
  }
}

run "worker_gets_the_same_secrets" {
  command = plan

  assert {
    condition     = local.worker_container.secrets == local.api_secrets
    error_message = "the worker shares the api secrets, including QDRANT_API_KEY"
  }
}

run "qdrant_requires_its_api_key" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_ecs_task_definition.qdrant.container_definitions)[0].secrets : "${s.name}=${s.valueFrom}"
    ] == ["QDRANT__SERVICE__API_KEY=arn:aws:ssm:ap-south-1:123456789012:parameter/blogplatform/prod/qdrant_api_key"]
    error_message = "the Qdrant container is started with the same API key the clients send"
  }
}
