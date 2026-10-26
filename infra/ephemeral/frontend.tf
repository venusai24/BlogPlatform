# ── S3 Bucket for Frontend ────────────────────────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  count = var.edge_mode == "alb_https" ? 0 : 1

  bucket_prefix = "${local.name_prefix}-frontend-"
  force_destroy = true

  tags = {
    Name = "${local.name_prefix}-frontend"
  }
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  count = var.edge_mode == "alb_https" ? 0 : 1

  bucket = aws_s3_bucket.frontend[0].id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  count = var.edge_mode == "alb_https" ? 0 : 1

  bucket = aws_s3_bucket.frontend[0].id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  count = var.edge_mode == "alb_https" ? 0 : 1

  bucket = aws_s3_bucket.frontend[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend[0].arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
