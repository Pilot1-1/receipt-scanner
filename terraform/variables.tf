variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Prefix used in resource names"
  type        = string
  default     = "receipt-scanner"
}

variable "environment" {
  description = "Environment name (dev or prod); set in envs/<name>.tfvars"
  type        = string
}

variable "gemini_model" {
  description = "Gemini model used to read receipts"
  type        = string
  default     = "gemini-2.5-flash-lite"
}

variable "allow_self_signup" {
  description = "true: anyone can register an account; false: only you can create accounts"
  type        = bool
  default     = false
}

variable "allow_password_auth" {
  description = "true: the Cognito app client also accepts the simple USER_PASSWORD_AUTH flow (handy for curl and AWS CLI tests). Use false in prod: the website signs in with SRP, which never sends the password"
  type        = bool
  default     = true
}

variable "enable_vpc" {
  description = "true: the API Lambda runs in a private VPC and reaches S3 and DynamoDB through free gateway endpoints"
  type        = bool
  default     = true
}

variable "vpc_cidr" {
  description = "Address range of the VPC (used only when enable_vpc = true)"
  type        = string
  default     = "10.20.0.0/16"
}

variable "alert_email" {
  description = "E-mail address for alarms and budget warnings. Leave empty to skip the subscription and the budget. AWS sends a confirmation message that must be clicked"
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly cost in USD that triggers a budget warning (only when alert_email is set)"
  type        = number
  default     = 5
}

variable "dev_origins" {
  description = "Extra websites allowed to call the API and upload to S3 from a browser: the local Vite server. Use [] in prod. The CloudFront site is always allowed."
  type        = list(string)
  default     = ["http://localhost:5173"]
}
