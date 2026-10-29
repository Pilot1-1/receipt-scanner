terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "${var.project_name}-${var.environment}-processor"

  # The Gemini key lives in SSM Parameter Store (created once with the AWS CLI,
  # so the secret never appears in Terraform code or state).
  key_param     = "/${var.project_name}/${var.environment}/gemini-api-key"
  key_param_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.key_param}"
}

# Zip the Lambda code from src/processor on every apply.
data "archive_file" "processor" {
  type        = "zip"
  source_dir  = "${path.root}/../src/processor"
  output_path = "${path.module}/processor.zip"
}

resource "aws_cloudwatch_log_group" "processor" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}

# --- IAM: the Lambda may do only what it needs, nothing more ---
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "processor" {
  name               = "${local.name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "permissions" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.processor.arn}:*"]
  }

  statement {
    sid       = "ReadUploadedPhotos"
    actions   = ["s3:GetObject"]
    resources = ["${var.bucket_arn}/uploads/*"]
  }

  statement {
    sid       = "ReadWriteReceipts"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "ReadGeminiKey"
    actions   = ["ssm:GetParameter"]
    resources = [local.key_param_arn]
  }
}

resource "aws_iam_role_policy" "processor" {
  name   = "least-privilege"
  role   = aws_iam_role.processor.id
  policy = data.aws_iam_policy_document.permissions.json
}

# --- The function itself ---
resource "aws_lambda_function" "processor" {
  function_name    = local.name
  role             = aws_iam_role.processor.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.processor.output_path
  source_code_hash = data.archive_file.processor.output_base64sha256
  timeout          = 180
  memory_size      = 256

  environment {
    variables = {
      TABLE_NAME       = var.table_name
      GEMINI_MODEL     = var.gemini_model
      GEMINI_KEY_PARAM = local.key_param
    }
  }

  depends_on = [aws_cloudwatch_log_group.processor]
}

# --- Trigger: a new object under uploads/ starts the Lambda ---
resource "aws_lambda_permission" "from_s3" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.processor.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = var.bucket_arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_s3_bucket_notification" "uploads" {
  bucket = var.bucket_name

  lambda_function {
    lambda_function_arn = aws_lambda_function.processor.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
  }

  depends_on = [aws_lambda_permission.from_s3]
}
