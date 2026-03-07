output "audio_bucket_name" {
  value = aws_s3_bucket.audio.id
}

output "audio_bucket_arn" {
  value = aws_s3_bucket.audio.arn
}

output "frontend_bucket_name" {
  value = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  value = aws_s3_bucket.frontend.arn
}

output "frontend_bucket_regional_domain_name" {
  value = aws_s3_bucket.frontend.bucket_regional_domain_name
}

output "landing_bucket_name" {
  value = aws_s3_bucket.landing.id
}

output "landing_bucket_arn" {
  value = aws_s3_bucket.landing.arn
}

output "landing_bucket_regional_domain_name" {
  value = aws_s3_bucket.landing.bucket_regional_domain_name
}
