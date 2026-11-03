output "alerts_topic_arn" {
  description = "SNS topic every alarm publishes to"
  value       = aws_sns_topic.alerts.arn
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.main.dashboard_name
}
