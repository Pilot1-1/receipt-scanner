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

variable "dev_origins" {
  description = "Extra websites allowed to call the API and upload to S3 from a browser: the local Vite server. Use [] in prod. The CloudFront site is always allowed."
  type        = list(string)
  default     = ["http://localhost:5173"]
}
