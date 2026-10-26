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

run "vector_defaults" {
  command = plan

  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "VECTOR_STORE=qdrant") && contains([for e in local.common_environment : "${e.name}=${e.value}"], "VECTOR_STORE_WRITE=primary")
    error_message = "Qdrant stays the store until the migration is done"
  }
  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "S3_VECTORS_BUCKET=blogplatform-prod-vectors")
    error_message = "the app knows the vector bucket name"
  }
  assert {
    condition     = length(local.ecs_task_policy_statements) == 2
    error_message = "no S3 Vectors permissions while it is not in use"
  }
}

run "dual_write_grants_s3_vectors" {
  command = plan

  variables {
    vector_store_write = "both"
  }

  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "VECTOR_STORE_WRITE=both")
    error_message = "VECTOR_STORE_WRITE reaches the containers"
  }
  assert {
    condition = length([
      for s in local.ecs_task_policy_statements : s if contains(s.Action, "s3vectors:PutVectors")
    ][0].Resource) == 2
    error_message = "S3 Vectors permissions cover the bucket and its indexes, nothing else"
  }
  assert {
    condition = toset([
      for s in local.ecs_task_policy_statements : s if contains(s.Action, "s3vectors:PutVectors")
      ][0].Resource) == toset([
      "arn:aws:s3vectors:ap-south-1:123456789012:bucket/blogplatform-prod-vectors",
      "arn:aws:s3vectors:ap-south-1:123456789012:bucket/blogplatform-prod-vectors/index/*"
    ])
    error_message = "resource ARNs"
  }
  assert {
    condition = toset([
      for s in local.ecs_task_policy_statements : s if contains(s.Action, "s3vectors:PutVectors")
      ][0].Action) == toset([
      "s3vectors:GetIndex", "s3vectors:PutVectors", "s3vectors:DeleteVectors", "s3vectors:QueryVectors", "s3vectors:GetVectors", "s3vectors:ListVectors"
    ])
    error_message = "the indexes already exist (persistent stack): no Create* actions"
  }
}

run "s3_vectors_as_the_read_store" {
  command = plan

  variables {
    vector_store = "s3vectors"
  }

  assert {
    condition     = contains([for e in local.common_environment : "${e.name}=${e.value}"], "VECTOR_STORE=s3vectors")
    error_message = "VECTOR_STORE reaches the containers"
  }
  assert {
    condition     = length(local.ecs_task_policy_statements) == 3
    error_message = "permissions follow the read store as well"
  }
}

run "invalid_vector_store" {
  command = plan

  variables {
    vector_store = "pinecone"
  }

  expect_failures = [var.vector_store]
}

run "invalid_vector_store_write" {
  command = plan

  variables {
    vector_store_write = "everywhere"
  }

  expect_failures = [var.vector_store_write]
}
