output "api_url" {
  description = "Base URL of the HTTP API"
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

# Used by add-on modules (for example bills/) to add their own routes to this API, with the same sign-in check.
output "api_id" {
  value = aws_apigatewayv2_api.api.id
}

output "execution_arn" {
  value = aws_apigatewayv2_api.api.execution_arn
}

output "authorizer_id" {
  value = aws_apigatewayv2_authorizer.jwt.id
}
