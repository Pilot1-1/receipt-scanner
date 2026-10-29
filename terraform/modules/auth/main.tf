terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  name = "${var.project_name}-${var.environment}"
}

# --- Users: Cognito stores accounts and passwords, so we never handle them ---
resource "aws_cognito_user_pool" "users" {
  name = "${local.name}-users"

  # People sign in with their e-mail address.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # In prod Terraform refuses to delete the pool (and every account in it).
  deletion_protection = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # false: anyone can register themselves (e-mail code required).
  # true:  only you can create accounts, with "aws cognito-idp admin-create-user".
  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_self_signup
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# The "app" that is allowed to sign users in (the website, or the AWS CLI while testing).
resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # A browser app cannot keep a secret, so this client has none.
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",      # password is never sent: what the website should use
    "ALLOW_USER_PASSWORD_AUTH", # simple login, handy for curl / AWS CLI tests
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED" # wrong e-mail and wrong password look the same
  enable_token_revocation       = true      # sign-out really invalidates the refresh token

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
