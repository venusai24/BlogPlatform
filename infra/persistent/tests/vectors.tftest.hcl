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

run "vector_bucket_and_indexes" {
  command = plan

  assert {
    condition     = aws_s3vectors_vector_bucket.vectors.vector_bucket_name == "blogplatform-prod-vectors"
    error_message = "vector bucket name"
  }
  assert {
    condition     = length(aws_s3vectors_index.this) == 3
    error_message = "three indexes: titles, content, summaries"
  }
  assert {
    condition     = toset(keys(aws_s3vectors_index.this)) == toset(["blog-titles", "blog-content", "blog-summaries"])
    error_message = "index names"
  }
  assert {
    condition     = alltrue([for i in values(aws_s3vectors_index.this) : i.dimension == 512 && i.data_type == "float32" && i.distance_metric == "cosine"])
    error_message = "every index is 512-dimension float32 cosine (Titan v2 at 512)"
  }
  assert {
    condition     = alltrue([for i in values(aws_s3vectors_index.this) : toset(one(i.metadata_configuration).non_filterable_metadata_keys) == toset(["snippet", "title"])])
    error_message = "snippet and title are stored but not filterable"
  }
}

run "vector_bucket_output" {
  command = plan

  assert {
    condition     = output.vector_bucket_name == "blogplatform-prod-vectors"
    error_message = "the ephemeral stack and the app read the bucket name"
  }
}
