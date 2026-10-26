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

run "api_images_are_immutable" {
  command = plan

  assert {
    condition     = aws_ecr_repository.api.image_tag_mutability == "IMMUTABLE"
    error_message = "an image tag, once pushed, always means the same image"
  }
}
