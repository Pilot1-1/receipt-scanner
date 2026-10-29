variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
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

variable "gemini_model" {
  description = "Gemini model used to read receipts"
  type        = string
}
