variable "project_name" {
  description = "Prefix used in resource names"
  type        = string
}

variable "environment" {
  description = "Environment name (dev or prod)"
  type        = string
}

variable "allowed_origins" {
  description = "Websites allowed to upload photos to the bucket from a browser"
  type        = list(string)
}
