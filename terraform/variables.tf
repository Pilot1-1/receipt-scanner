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
