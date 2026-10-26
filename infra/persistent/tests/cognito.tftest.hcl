mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z123" }
  }
}

variables {
  github_repo  = "venusai24/BlogPlatform"
  budget_email = "ops@example.com"
  alert_email  = "ops@example.com"
  domain_name  = "example.click"
}

run "app_client_is_a_public_pkce_client" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.web.generate_secret == false
    error_message = "a browser app cannot keep a client secret"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.allowed_oauth_flows == toset(["code"]) && aws_cognito_user_pool_client.web.allowed_oauth_flows_user_pool_client == true
    error_message = "authorization code flow only (no implicit flow)"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.allowed_oauth_scopes == toset(["openid", "profile"])
    error_message = "scopes"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.supported_identity_providers == toset(["COGNITO"])
    error_message = "no social providers"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.explicit_auth_flows == toset(["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"])
    error_message = "SRP and refresh only: the password never reaches the API"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.prevent_user_existence_errors == "ENABLED" && aws_cognito_user_pool_client.web.enable_token_revocation == true
    error_message = "do not reveal which usernames exist; revoke refresh tokens on sign-out"
  }
}

run "app_client_urls" {
  command = plan

  assert {
    condition     = contains(aws_cognito_user_pool_client.web.callback_urls, "https://app.example.click/callback") && contains(aws_cognito_user_pool_client.web.callback_urls, "http://localhost:3000/callback")
    error_message = "callback URLs: the app and local development"
  }
  assert {
    condition     = contains(aws_cognito_user_pool_client.web.logout_urls, "https://app.example.click/login") && contains(aws_cognito_user_pool_client.web.logout_urls, "http://localhost:3000/login")
    error_message = "logout URLs"
  }
}

run "app_client_token_lifetimes" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.web.access_token_validity == 60 && aws_cognito_user_pool_client.web.id_token_validity == 60 && aws_cognito_user_pool_client.web.refresh_token_validity == 30
    error_message = "60 minute access and id tokens, 30 day refresh token"
  }
  assert {
    condition     = one(aws_cognito_user_pool_client.web.token_validity_units).access_token == "minutes" && one(aws_cognito_user_pool_client.web.token_validity_units).id_token == "minutes" && one(aws_cognito_user_pool_client.web.token_validity_units).refresh_token == "days"
    error_message = "units"
  }
}

run "user_pool" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool.this.name == "blogplatform-prod" && aws_cognito_user_pool.this.deletion_protection == "ACTIVE"
    error_message = "the pool cannot be deleted by accident"
  }
  assert {
    condition     = one(aws_cognito_user_pool.this.username_configuration).case_sensitive == false
    error_message = "usernames are case-insensitive"
  }
  assert {
    condition     = one(aws_cognito_user_pool.this.password_policy).minimum_length == 12 && one(aws_cognito_user_pool.this.password_policy).require_lowercase == true && one(aws_cognito_user_pool.this.password_policy).require_uppercase == true && one(aws_cognito_user_pool.this.password_policy).require_numbers == true
    error_message = "password policy"
  }
  assert {
    condition     = aws_cognito_user_pool.this.mfa_configuration == "OPTIONAL" && one(aws_cognito_user_pool.this.software_token_mfa_configuration).enabled == true
    error_message = "optional authenticator-app MFA"
  }
}

run "hosted_domain_and_outputs" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_domain.this.domain == "bp-prod-789012"
    error_message = "domain prefix from the account id"
  }
  assert {
    condition     = output.cognito_domain == "https://bp-prod-789012.auth.ap-south-1.amazoncognito.com"
    error_message = "managed login URL"
  }
}

run "without_a_domain_only_localhost_is_allowed" {
  command = plan

  variables {
    domain_name = ""
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.callback_urls == toset(["http://localhost:3000/callback"]) && aws_cognito_user_pool_client.web.logout_urls == toset(["http://localhost:3000/login"])
    error_message = "no app.<empty> URLs before a domain exists"
  }
}
