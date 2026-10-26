# Amazon Cognito user pool for sign-in (AUTH_PROVIDER=cognito). It lives in the persistent stack so the
# users survive an ephemeral teardown. The API only verifies the access tokens it issues; the browser
# signs in on Cognito managed login with the authorization code flow and PKCE.

locals {
  cognito_domain_prefix = "bp-${var.env}-${substr(data.aws_caller_identity.current.account_id, 6, 6)}"

  # The app's own URLs exist only once a domain does; localhost always works for development.
  cognito_callback_urls = concat(
    var.domain_name != "" ? ["https://app.${var.domain_name}/callback"] : [],
    ["http://localhost:3000/callback"]
  )
  cognito_logout_urls = concat(
    var.domain_name != "" ? ["https://app.${var.domain_name}/login"] : [],
    ["http://localhost:3000/login"]
  )
}

resource "aws_cognito_user_pool" "this" {
  name = "blogplatform-${var.env}"

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email is optional: migrated users have none on record.
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {}
  }

  deletion_protection = "ACTIVE"
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = local.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "blogplatform-${var.env}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  # A browser app cannot keep a secret; PKCE protects the code flow instead.
  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = local.cognito_callback_urls
  logout_urls   = local.cognito_logout_urls

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

output "cognito_user_pool_id" {
  description = "Cognito user pool id (COGNITO_USER_POOL_ID)"
  value       = aws_cognito_user_pool.this.id
}

output "cognito_client_id" {
  description = "Cognito app client id (COGNITO_CLIENT_ID and the frontend build argument)"
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  description = "Managed login base URL"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"
}
