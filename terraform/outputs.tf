output "site_url" {
  description = "Address of the website (open this in the browser)"
  value       = local.site_url
}

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

output "api_url" {
  description = "Base URL of the HTTP API (POST /upload-url, GET /receipts); every call needs a sign-in token"
  value       = module.api.api_url
}

output "user_pool_id" {
  description = "Cognito user pool that holds the accounts"
  value       = module.auth.user_pool_id
}

output "user_pool_client_id" {
  description = "Cognito app client the website (or the CLI) signs in with"
  value       = module.auth.client_id
}

output "frontend_config" {
  description = "Same settings the site reads from /config.json. Save it to frontend/public/config.json to run the site locally."
  value       = local.frontend_config
}
