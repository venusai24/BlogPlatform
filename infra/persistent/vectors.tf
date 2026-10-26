# S3 Vectors holds the search index. It lives in the persistent stack (ADR-014) so the index survives
# an ephemeral teardown. Needs the AWS provider 6.x (5.x has no s3vectors resources).
#
# Embeddings come from Titan Text Embeddings v2 at 512 dimensions (EMBEDDING_DIM); changing the
# dimension means creating new indexes and re-indexing.

locals {
  vector_dimension = 512

  vector_indexes = toset(["blog-titles", "blog-content", "blog-summaries"])
}

resource "aws_s3vectors_vector_bucket" "vectors" {
  vector_bucket_name = "blogplatform-${var.env}-vectors"
}

resource "aws_s3vectors_index" "this" {
  for_each = local.vector_indexes

  vector_bucket_name = aws_s3vectors_vector_bucket.vectors.vector_bucket_name
  index_name         = each.value
  data_type          = "float32"
  dimension          = local.vector_dimension
  distance_metric    = "cosine"

  # The text is stored with the vector but never used in a filter, which keeps within the
  # 2 KB filterable-metadata limit.
  metadata_configuration {
    non_filterable_metadata_keys = ["snippet", "title"]
  }
}

output "vector_bucket_name" {
  description = "Name of the S3 Vectors bucket (the app reads it as S3_VECTORS_BUCKET)"
  value       = aws_s3vectors_vector_bucket.vectors.vector_bucket_name
}
