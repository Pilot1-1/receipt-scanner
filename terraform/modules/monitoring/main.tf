terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

data "aws_region" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"

  has_email = var.alert_email != ""

  # The processor's log group is created in its own module; the name is fixed by Lambda.
  processor_log_group = "/aws/lambda/${var.processor_function_name}"
}

# --- Where alarms go: one SNS topic, optionally with an e-mail subscription ---
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

# AWS sends a confirmation e-mail; the subscription works only after the link in it is clicked.
resource "aws_sns_topic_subscription" "email" {
  count = local.has_email ? 1 : 0

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# --- Alarms ---
# treat_missing_data = notBreaching: no traffic is not an incident.

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.name}-api-lambda-errors"
  alarm_description   = "The API Lambda raised an error (unhandled exception, timeout, out of memory)"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.api_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "processor_errors" {
  alarm_name          = "${local.name}-processor-lambda-errors"
  alarm_description   = "The processor Lambda crashed (a bad photo alone does not count: that is saved as status=failed)"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.processor_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "processor_slow" {
  alarm_name          = "${local.name}-processor-slow"
  alarm_description   = "Reading one receipt took more than 120 s (the Lambda timeout is 180 s)"
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = { FunctionName = var.processor_function_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 120000 # milliseconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-gateway-5xx"
  alarm_description   = "API Gateway answered 5xx to the website"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id, Stage = "$default" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Gemini failures (rate limit, wrong key, model removed) are written to the log as "Gemini HTTP <code>".
# They do not make the Lambda fail, so the Errors metric above never sees them: count them from the log.
resource "aws_cloudwatch_log_metric_filter" "gemini_errors" {
  name           = "${local.name}-gemini-errors"
  log_group_name = local.processor_log_group
  pattern        = "\"Gemini HTTP\""

  metric_transformation {
    name          = "GeminiErrors"
    namespace     = "ReceiptScanner/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "gemini_errors" {
  alarm_name          = "${local.name}-gemini-errors"
  alarm_description   = "Gemini rejected 3 or more requests in 15 minutes: quota, API key or model name"
  namespace           = "ReceiptScanner/${var.environment}"
  metric_name         = "GeminiErrors"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.gemini_errors]
}

# --- Dashboard: one page with everything worth looking at during the demo ---
# The layout is plain JSON in dashboard.json.tftpl (easier to read and edit than HCL); Terraform only fills in
# the names and the alarm ARNs.
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name

  dashboard_body = templatefile("${path.module}/dashboard.json.tftpl", {
    project_name            = var.project_name
    environment             = var.environment
    region                  = data.aws_region.current.region
    api_id                  = var.api_id
    api_function_name       = var.api_function_name
    processor_function_name = var.processor_function_name
    table_name              = var.table_name
    alarm_arns = [
      aws_cloudwatch_metric_alarm.api_errors.arn,
      aws_cloudwatch_metric_alarm.processor_errors.arn,
      aws_cloudwatch_metric_alarm.processor_slow.arn,
      aws_cloudwatch_metric_alarm.api_5xx.arn,
      aws_cloudwatch_metric_alarm.gemini_errors.arn,
    ]
  })
}

# --- Money: a warning before the free tier is used up ---
# AWS Budgets allows 2 budgets for free per account. Needs an e-mail address to be useful.
resource "aws_budgets_budget" "monthly" {
  count = local.has_email ? 1 : 0

  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
