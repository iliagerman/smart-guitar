output "distribution_id" {
  value = aws_cloudfront_distribution.spa.id
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.spa.domain_name
}

output "distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.spa.hosted_zone_id
}

output "landing_distribution_id" {
  value = aws_cloudfront_distribution.landing.id
}

output "landing_distribution_domain_name" {
  value = aws_cloudfront_distribution.landing.domain_name
}

output "landing_distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.landing.hosted_zone_id
}
