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

module "storage" {
  source       = "./modules/storage"
  project_name = var.project_name
  environment  = var.environment
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
