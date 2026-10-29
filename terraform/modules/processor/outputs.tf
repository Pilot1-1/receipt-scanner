output "function_name" {
  value = aws_lambda_function.processor.function_name
}

output "key_parameter_name" {
  description = "SSM parameter that must contain the Gemini API key"
  value       = local.key_param
}
