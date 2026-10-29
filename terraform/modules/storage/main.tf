data "aws_caller_identity" "current" {}

locals {
  prefix     = "${var.project_name}-${var.environment}"
  user_index = "userId-createdAt-index"
}

# Receipt photos. The account id in the name keeps it globally unique.
resource "aws_s3_bucket" "receipts" {
  bucket = "${local.prefix}-receipts-${data.aws_caller_identity.current.account_id}"

  # Lets "terraform destroy" delete the bucket even if it contains photos.
  # Fine for a student project; do not use this for real user data.
  force_destroy = true
}

# Receipts are private: nobody can make this bucket public by accident.
resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# The browser uploads photos straight to S3 with a presigned URL. That is a
# cross-origin PUT (website -> S3), so the bucket must say the website may do it.
# Without this block the browser refuses the upload, even though curl works.
resource "aws_s3_bucket_cors_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# Parsed receipts (store, date, total, category, status).
# 5 read / 5 write units stays inside the always-free DynamoDB allowance.
resource "aws_dynamodb_table" "receipts" {
  name           = "${local.prefix}-receipts"
  billing_mode   = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "receiptId"

  attribute {
    name = "receiptId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # "Show me this user's receipts, newest first" without scanning the whole table.
  # 5 + 5 units here plus 5 + 5 above is still inside the 25-unit free allowance.
  global_secondary_index {
    name            = local.user_index
    hash_key        = "userId"
    range_key       = "createdAt"
    projection_type = "ALL"
    read_capacity   = 5
    write_capacity  = 5
  }
}
