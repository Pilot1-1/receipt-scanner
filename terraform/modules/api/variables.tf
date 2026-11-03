variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "bucket_name" {
  description = "Receipts bucket (from the storage module)"
  type        = string
}

variable "bucket_arn" {
  type = string
}

variable "table_name" {
  description = "Receipts table (from the storage module)"
  type        = string
}

variable "table_arn" {
  type = string
}

variable "user_index_name" {
  description = "Index on the receipts table that lists receipts by owner (from the storage module)"
  type        = string
}

variable "jwt_issuer" {
  description = "Token issuer, i.e. the Cognito user pool (from the auth module)"
  type        = string
}

variable "jwt_audience" {
  description = "App client ids whose tokens are accepted (from the auth module)"
  type        = list(string)
}

variable "allowed_origins" {
  description = "Websites allowed to call the API from a browser; [\"*\"] means any"
  type        = list(string)
  default     = ["*"]
}

variable "budgets_table_name" {
  description = "Table with the monthly limits per user (from the storage module)"
  type        = string
}

variable "budgets_table_arn" {
  type = string
}

variable "vpc_enabled" {
  description = "true: run the Lambda in the VPC given by subnet_ids and security_group_ids"
  type        = bool
  default     = false
}

variable "subnet_ids" {
  description = "Private subnets for the Lambda (from the network module); used only when vpc_enabled is true"
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "Security groups of the Lambda; used only when vpc_enabled is true"
  type        = list(string)
  default     = []
}
