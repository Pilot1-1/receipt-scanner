output "receipts_bucket" {
  description = "S3 bucket that stores uploaded receipt photos"
  value       = module.storage.bucket_name
}

output "receipts_table" {
  description = "DynamoDB table that stores parsed receipts"
  value       = module.storage.table_name
}

output "processor_function" {
  description = "Lambda that reads receipts with Gemini"
  value       = module.processor.function_name
}

output "gemini_key_parameter" {
  description = "SSM parameter that must hold the Gemini API key"
  value       = module.processor.key_parameter_name
}
