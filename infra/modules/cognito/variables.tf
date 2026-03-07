variable "project_name" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID (from Google Cloud Console)"
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret (from Google Cloud Console)"
  type        = string
  sensitive   = true
}

variable "certificate_arn" {
  description = "ACM certificate ARN for custom Cognito domain (wildcard cert, must be in us-east-1)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 public hosted zone ID for DNS record creation"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
