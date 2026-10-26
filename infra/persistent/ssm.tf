# Placeholder SecureString parameters for secrets
# The human must manually update these via CLI or AWS Console
# e.g., aws ssm put-parameter --name /blogplatform/prod/mongodb_uri --value "..." --type SecureString --overwrite

resource "aws_ssm_parameter" "mongodb_uri" {
  name  = "/blogplatform/${var.env}/mongodb_uri"
  type  = "SecureString"
  value = "REPLACE_ME_MANUALLY"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "qdrant_api_key" {
  name  = "/blogplatform/${var.env}/qdrant_api_key"
  type  = "SecureString"
  value = "REPLACE_ME_MANUALLY"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/blogplatform/${var.env}/jwt_secret"
  type  = "SecureString"
  value = "REPLACE_ME_MANUALLY"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "hf_token" {
  name  = "/blogplatform/${var.env}/hf_token"
  type  = "SecureString"
  value = "REPLACE_ME_MANUALLY"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "groq_api_key" {
  name  = "/blogplatform/${var.env}/groq_api_key"
  type  = "SecureString"
  value = "REPLACE_ME_MANUALLY"

  lifecycle {
    ignore_changes = [value]
  }
}
