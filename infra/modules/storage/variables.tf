variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "audio_cors_allowed_origins" {
  description = "Allowed origins for browser access to presigned audio/job manifest objects."
  type        = list(string)
  nullable    = false
}
