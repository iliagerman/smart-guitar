output "acm_certificate_arn" {
  value = aws_acm_certificate.wildcard.arn
}

output "acm_certificate_validation_arn" {
  value = aws_acm_certificate_validation.wildcard.certificate_arn
}

output "public_hosted_zone_id" {
  value = local.public_hosted_zone_id
}

output "private_hosted_zone_id" {
  value = aws_route53_zone.private.zone_id
}
