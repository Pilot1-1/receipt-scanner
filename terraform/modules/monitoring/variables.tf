variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "api_function_name" {
  description = "API Lambda (from the api module)"
  type        = string
}

variable "processor_function_name" {
  description = "Processor Lambda (from the processor module)"
  type        = string
}

variable "api_id" {
  description = "HTTP API id (from the api module)"
  type        = string
}

variable "table_name" {
  description = "Receipts table (from the storage module)"
  type        = string
}

variable "alert_email" {
  description = "Where alarms and budget warnings are sent. Empty: alarms still exist but nobody is e-mailed, and no budget is created"
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly cost (USD) that triggers a warning at 80% (actual) and 100% (forecast)"
  type        = number
  default     = 5
}
