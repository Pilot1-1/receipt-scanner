terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Every resource gets these tags automatically (useful for cost tracking).
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  site_url = "https://${module.frontend.domain_name}"

  # The only websites a browser may call the API / upload from: our CloudFront site
  # (and the local dev server). Replaces the old ["*"].
  allowed_origins = concat([local.site_url], var.dev_origins)

  # What the website needs to know. Written to /config.json by the frontend module.
  frontend_config = {
    region      = var.aws_region
    apiUrl      = module.api.api_url
    userPoolId  = module.auth.user_pool_id
    clientId    = module.auth.client_id
    allowSignup = var.allow_self_signup
  }
}

module "storage" {
  source          = "./modules/storage"
  project_name    = var.project_name
  environment     = var.environment
  allowed_origins = local.allowed_origins
}

module "processor" {
  source       = "./modules/processor"
  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region
  bucket_name  = module.storage.bucket_name
  bucket_arn   = module.storage.bucket_arn
  table_name   = module.storage.table_name
  table_arn    = module.storage.table_arn
  gemini_model = var.gemini_model
}

module "auth" {
  source              = "./modules/auth"
  project_name        = var.project_name
  environment         = var.environment
  allow_self_signup   = var.allow_self_signup
  allow_password_auth = var.allow_password_auth
}

# Private network for the API Lambda (no internet access, so it costs nothing).
# The processor Lambda stays outside: it has to reach the Gemini API on the internet.
module "network" {
  count = var.enable_vpc ? 1 : 0

  source       = "./modules/network"
  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
}

module "api" {
  source             = "./modules/api"
  project_name       = var.project_name
  environment        = var.environment
  bucket_name        = module.storage.bucket_name
  bucket_arn         = module.storage.bucket_arn
  table_name         = module.storage.table_name
  table_arn          = module.storage.table_arn
  user_index_name    = module.storage.user_index_name
  budgets_table_name = module.storage.budgets_table_name
  budgets_table_arn  = module.storage.budgets_table_arn
  jwt_issuer         = module.auth.issuer
  jwt_audience       = [module.auth.client_id]
  allowed_origins    = local.allowed_origins
  vpc_enabled        = var.enable_vpc
  subnet_ids         = var.enable_vpc ? module.network[0].private_subnet_ids : []
  security_group_ids = var.enable_vpc ? [module.network[0].lambda_security_group_id] : []
}

module "monitoring" {
  source                  = "./modules/monitoring"
  project_name            = var.project_name
  environment             = var.environment
  api_function_name       = module.api.function_name
  processor_function_name = module.processor.function_name
  api_id                  = module.api.api_id
  table_name              = module.storage.table_name
  alert_email             = var.alert_email
  monthly_budget_usd      = var.monthly_budget_usd
}

module "frontend" {
  source       = "./modules/frontend"
  project_name = var.project_name
  environment  = var.environment
  dist_dir     = "${path.root}/../frontend/dist"
  config       = local.frontend_config
}
