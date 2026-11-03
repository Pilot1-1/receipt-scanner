variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_cidr" {
  description = "Address range of the VPC; it is split into one /24 per private subnet"
  type        = string
  default     = "10.20.0.0/16"
}
