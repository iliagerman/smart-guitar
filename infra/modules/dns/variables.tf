variable "domain_name" {
  type = string
}

variable "hosted_zone_id" {
  description = "Existing Route53 public hosted zone ID"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
