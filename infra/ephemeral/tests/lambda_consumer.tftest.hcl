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

run "lambda_runtime" {
  command = plan

  variables {
    enable_worker_service     = true
    enable_domain_events      = true
    indexing_consumer_runtime = "lambda"
    indexing_consumer_mode    = "active"
    lambda_image_tag          = "abc123-lambda"
  }

  assert {
    condition     = aws_lambda_function.indexing_consumer[0].function_name == "blogplatform-prod-indexing-consumer"
    error_message = "function name matches the CI deploy role's resource ARN"
  }
  assert {
    condition     = aws_lambda_function.indexing_consumer[0].package_type == "Image" && aws_lambda_function.indexing_consumer[0].image_uri == "123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-api:abc123-lambda"
    error_message = "the function runs the -lambda image from the api repository"
  }
  assert {
    condition     = aws_lambda_function.indexing_consumer[0].timeout == 60 && aws_lambda_function.indexing_consumer[0].memory_size == 512
    error_message = "60 s, 512 MB"
  }
  assert {
    condition     = aws_lambda_event_source_mapping.indexing[0].function_response_types == toset(["ReportBatchItemFailures"])
    error_message = "partial batch failures: only failed records are retried"
  }
  assert {
    condition     = one(aws_lambda_event_source_mapping.indexing[0].scaling_config).maximum_concurrency == 2
    error_message = "two concurrent invocations x pool of 2 protects Atlas M0's connection limit"
  }
  assert {
    condition     = aws_lambda_event_source_mapping.indexing[0].batch_size == 10 && aws_lambda_event_source_mapping.indexing[0].maximum_batching_window_in_seconds == 5 && aws_lambda_event_source_mapping.indexing[0].enabled == true
    error_message = "batch of 10, 5 s window, enabled"
  }
  assert {
    condition     = aws_sqs_queue.indexing[0].visibility_timeout_seconds == 360
    error_message = "visibility timeout is 6x the function timeout, per AWS guidance"
  }
  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "INDEXING_CONSUMER_RUNTIME=lambda")
    error_message = "the worker is told not to poll the queue itself"
  }
  assert {
    condition     = one(aws_lambda_function.indexing_consumer[0].environment).variables["MONGO_MAX_POOL_SIZE"] == "2" && one(aws_lambda_function.indexing_consumer[0].environment).variables["SERVICE_NAME"] == "indexing-lambda" && one(aws_lambda_function.indexing_consumer[0].environment).variables["APP_ENV"] == "prod" && one(aws_lambda_function.indexing_consumer[0].environment).variables["PORT"] == "0"
    error_message = "function environment"
  }
  assert {
    condition     = !contains(keys(one(aws_lambda_function.indexing_consumer[0].environment).variables), "AWS_REGION")
    error_message = "AWS_REGION is reserved by Lambda; setting it makes the function fail to create"
  }
  assert {
    condition     = !contains(keys(one(aws_lambda_function.indexing_consumer[0].environment).variables), "MONGODB_URI") && !contains(keys(one(aws_lambda_function.indexing_consumer[0].environment).variables), "JWT_S123456789012.dkr.ecr.ap-south-1.amazonaws.com/blogplatform-apiET")
    error_message = "secrets are read from SSM by the handler, never put in the function's environment"
  }
  assert {
    condition     = length(local.lambda_consumer_policy_statements) == 3
    error_message = "queue, SSM and Bedrock only"
  }
  assert {
    condition     = aws_cloudwatch_log_group.lambda_consumer[0].name == "/aws/lambda/blogplatform-prod-indexing-consumer" && aws_cloudwatch_log_group.lambda_consumer[0].retention_in_days == 14
    error_message = "log group"
  }
}

run "lambda_policy_includes_s3_vectors_when_used" {
  command = plan

  variables {
    enable_worker_service     = true
    enable_domain_events      = true
    indexing_consumer_runtime = "lambda"
    lambda_image_tag          = "abc123-lambda"
    vector_store              = "s3vectors"
  }

  assert {
    condition     = length(local.lambda_consumer_policy_statements) == 4
    error_message = "S3 Vectors permissions follow the store"
  }
}

run "lambda_consumer_off_disables_the_mapping" {
  command = plan

  variables {
    enable_worker_service     = true
    enable_domain_events      = true
    indexing_consumer_runtime = "lambda"
    indexing_consumer_mode    = "off"
    lambda_image_tag          = "abc123-lambda"
  }

  assert {
    condition     = aws_lambda_event_source_mapping.indexing[0].enabled == false
    error_message = "consumer mode off means the function is not invoked"
  }
}

run "ecs_runtime" {
  command = plan

  variables {
    enable_worker_service = true
    enable_domain_events  = true
  }

  assert {
    condition     = length(aws_lambda_function.indexing_consumer) == 0 && length(aws_lambda_event_source_mapping.indexing) == 0 && length(aws_iam_role.lambda_consumer) == 0 && length(aws_security_group.lambda_consumer) == 0
    error_message = "no Lambda resources on the ecs runtime"
  }
  assert {
    condition     = aws_sqs_queue.indexing[0].visibility_timeout_seconds == 120
    error_message = "visibility timeout stays 120 s"
  }
  assert {
    condition     = contains([for e in local.worker_environment : "${e.name}=${e.value}"], "INDEXING_CONSUMER_RUNTIME=ecs")
    error_message = "worker keeps polling"
  }
}

run "lambda_runtime_needs_events" {
  command = plan

  variables {
    indexing_consumer_runtime = "lambda"
    lambda_image_tag          = "abc123-lambda"
  }

  assert {
    condition     = length(aws_lambda_function.indexing_consumer) == 0
    error_message = "without domain events there is no queue to consume"
  }
}

run "lambda_runtime_requires_an_image_tag" {
  command = plan

  variables {
    enable_worker_service     = true
    enable_domain_events      = true
    indexing_consumer_runtime = "lambda"
  }

  expect_failures = [aws_lambda_function.indexing_consumer]
}

run "invalid_runtime" {
  command = plan

  variables {
    indexing_consumer_runtime = "fargate"
  }

  expect_failures = [var.indexing_consumer_runtime]
}
