output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Subnets the API Lambda runs in"
  value       = aws_subnet.private[*].id
}

output "lambda_security_group_id" {
  description = "Security group of the API Lambda"
  value       = aws_security_group.lambda.id
}
