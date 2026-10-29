variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "dist_dir" {
  description = "Folder with the built website (output of \"npm run build\")"
  type        = string
}

variable "config" {
  description = "Settings the website reads at start-up; written to /config.json"
  type        = any
}
