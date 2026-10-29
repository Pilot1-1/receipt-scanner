output "bucket_name" {
  value = aws_s3_bucket.receipts.id
}

output "bucket_arn" {
  value = aws_s3_bucket.receipts.arn
}

output "table_name" {
  value = aws_dynamodb_table.receipts.name
}

output "table_arn" {
  value = aws_dynamodb_table.receipts.arn
}

output "user_index_name" {
  description = "Index that lists receipts by owner, newest first"
  value       = local.user_index
}
