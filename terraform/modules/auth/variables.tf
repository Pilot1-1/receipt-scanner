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
