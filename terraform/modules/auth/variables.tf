variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "allow_self_signup" {
  description = "true: anyone can create an account; false: only the admin can"
  type        = bool
}

variable "allow_password_auth" {
  description = "true: also allow the simple USER_PASSWORD_AUTH flow (for curl / AWS CLI tests)"
  type        = bool
  default     = true
}
