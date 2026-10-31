# Monthly spending limits: one small row per user, { currency: { category: limit } }.
# 1 read + 1 write unit. Together with the receipts table and its index that is 11 read and
# 11 write units, inside the always-free allowance of 25 + 25.
resource "aws_dynamodb_table" "budgets" {
  name           = "${local.prefix}-budgets"
  billing_mode   = "PROVISIONED"
  read_capacity  = 1
  write_capacity = 1
  hash_key       = "userId"

  attribute {
    name = "userId"
    type = "S"
  }
}

output "budgets_table_name" {
  value = aws_dynamodb_table.budgets.name
}

output "budgets_table_arn" {
  value = aws_dynamodb_table.budgets.arn
}
