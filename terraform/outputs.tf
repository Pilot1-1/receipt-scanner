output "receipts_bucket" {
  description = "S3 bucket that stores uploaded receipt photos"
  value       = module.storage.bucket_name
}

output "receipts_table" {
  description = "DynamoDB table that stores parsed receipts"
  value       = module.storage.table_name
}
