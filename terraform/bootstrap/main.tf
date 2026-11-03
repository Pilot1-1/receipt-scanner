# Run ONCE per AWS account, before the main configuration. It creates the S3 bucket that holds the
# Terraform state of the main configuration (remote state), so the state is not a file on one laptop.
#
# This configuration keeps its own state locally (terraform/bootstrap/terraform.tfstate): the bucket
# cannot store the state of the thing that creates it. The file is tiny and can be re-imported.
#
#   cd terraform/bootstrap
#   terraform init
#   terraform apply
#   terraform output -raw backend_config > ../backend.hcl      # then see docs/setup-guide.md

terraform {
  required_version = ">= 1.10" # the S3 backend lock file (use_lockfile) needs 1.10 or newer

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "project_name" {
  type    = string
  default = "receipt-scanner"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Purpose   = "terraform-state"
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"

  # The state is the only record of what Terraform built: do not let "terraform destroy" remove it.
  lifecycle {
    prevent_destroy = true
  }
}

# Every version of the state is kept, so a bad apply can be rolled back.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# The state can contain secrets (for example generated passwords): encrypt it.
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Refuse unencrypted transport.
data "aws_iam_policy_document" "state" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json

  depends_on = [aws_s3_bucket_public_access_block.state]
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

# Ready-made content for terraform/backend.hcl. The state key is added per environment at init time.
output "backend_config" {
  description = "Save as terraform/backend.hcl, then: terraform init -backend-config=backend.hcl -backend-config=\"key=<env>/terraform.tfstate\""
  value       = <<-EOT
    bucket       = "${aws_s3_bucket.state.id}"
    region       = "${var.aws_region}"
    encrypt      = true
    use_lockfile = true
  EOT
}
