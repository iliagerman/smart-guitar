variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "smart-guitar"
}

variable "domain_name" {
  description = "Root domain name"
  type        = string
  default     = "smart-guitar.com"
}

variable "hosted_zone_id" {
  description = "Existing Route53 public hosted zone ID"
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID"
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "runtime_observer_endpoint" {
  description = "Runtime Observer collector base URL"
  type        = string
  default     = "https://metrics.bobthebot.io"
}

variable "runtime_observer_project_name" {
  description = "Runtime Observer project name (must match the project the API key belongs to)"
  type        = string
  default     = "Smart-guitar"
}

variable "runtime_observer_api_key" {
  description = "Runtime Observer project API key (pass via TF_VAR_runtime_observer_api_key)"
  type        = string
  sensitive   = true
}
