output "user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "issuer" {
  description = "Who signs the tokens; API Gateway checks every token against this"
  value       = "https://${aws_cognito_user_pool.users.endpoint}"
}
