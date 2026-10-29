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

locals {
  name = "${var.project_name}-${var.environment}-api"
}

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.root}/../src/api"
  output_path = "${path.module}/api.zip"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}

# --- IAM: only what the API needs ---
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "permissions" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  # A presigned upload URL only works if the signer may put objects there.
  statement {
    sid       = "SignUploadsToUploadsFolder"
    actions   = ["s3:PutObject"]
    resources = ["${var.bucket_arn}/uploads/*"]
  }

  statement {
    sid       = "CreateReceipts"
    actions   = ["dynamodb:PutItem"]
    resources = [var.table_arn]
  }

  # Querying an index needs permission on the index itself, not on the table.
  statement {
    sid       = "ListOwnReceipts"
    actions   = ["dynamodb:Query"]
    resources = ["${var.table_arn}/index/${var.user_index_name}"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "least-privilege"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.permissions.json
}

# --- Lambda ---
resource "aws_lambda_function" "api" {
  function_name    = local.name
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      TABLE_NAME  = var.table_name
      BUCKET_NAME = var.bucket_name
      INDEX_NAME  = var.user_index_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

# --- API Gateway (HTTP API) ---
resource "aws_apigatewayv2_api" "api" {
  name          = local.name
  protocol_type = "HTTP"

  # Lets the website (another domain) call this API from the browser.
  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 3600
  }
}

# API Gateway checks the token (signature, expiry, issuer, app client) BEFORE
# the Lambda runs, so a request without a valid token never reaches our code
# and never costs a Lambda invocation.
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = var.jwt_audience
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "upload_url" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_route" "receipts" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /receipts"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # Protects the free tiers (Lambda, Gemini) from request floods.
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}

resource "aws_lambda_permission" "from_api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
