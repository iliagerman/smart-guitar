output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "user_pool_endpoint" {
  value = aws_cognito_user_pool.main.endpoint
}

output "cognito_domain" {
  description = "Cognito hosted UI domain"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "cognito_domain_cloudfront_distribution" {
  description = "CloudFront distribution for the Cognito custom domain"
  value       = aws_cognito_user_pool_domain.main.cloudfront_distribution
}
