variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "frontend_bucket_name" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_bucket_regional_domain_name" {
  type = string
}

variable "acm_certificate_arn" {
  type = string
}

variable "domain_aliases" {
  type    = list(string)
  default = []
}

variable "landing_bucket_name" {
  type = string
}

variable "landing_bucket_arn" {
  type = string
}

variable "landing_bucket_regional_domain_name" {
  type = string
}

variable "landing_domain_aliases" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
