################################################################################
# Networking
################################################################################

output "vpc_id" {
  value = module.networking.vpc_id
}

output "private_app_subnet_ids" {
  value = module.networking.private_app_subnet_ids
}

output "private_data_subnet_ids" {
  value = module.networking.private_data_subnet_ids
}

################################################################################
# ECR
################################################################################

output "ecr_inference_demucs_repo_url" {
  value = module.ecr.inference_demucs_repo_url
}

output "ecr_backend_api_repo_url" {
  value = module.ecr.backend_api_repo_url
}

output "ecr_lyrics_generator_repo_url" {
  value = module.ecr.lyrics_generator_repo_url
}


output "ecr_chords_generator_repo_url" {
  value = module.ecr.chords_generator_repo_url
}

output "ecr_job_orchestrator_repo_url" {
  value = module.ecr.job_orchestrator_repo_url
}

output "ecr_vocals_guitar_stitch_repo_url" {
  value = module.ecr.vocals_guitar_stitch_repo_url
}

output "ecr_stale_job_sweeper_repo_url" {
  value = module.ecr.stale_job_sweeper_repo_url
}

################################################################################
# Storage
################################################################################

output "audio_bucket_name" {
  value = module.storage.audio_bucket_name
}

output "audio_bucket_arn" {
  value = module.storage.audio_bucket_arn
}

output "frontend_bucket_name" {
  value = module.storage.frontend_bucket_name
}

################################################################################
# CDN
################################################################################

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "landing_cloudfront_distribution_id" {
  value = module.cdn.landing_distribution_id
}

output "landing_bucket_name" {
  value = module.storage.landing_bucket_name
}

################################################################################
# Database
################################################################################

output "rds_endpoint" {
  value     = module.database.rds_endpoint
  sensitive = true
}

output "db_name" {
  value = module.database.db_name
}

output "db_username" {
  value = module.database.db_username
}

output "db_password" {
  value     = module.database.db_password
  sensitive = true
}

################################################################################
# Cognito
################################################################################

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_user_pool_client_id" {
  value = module.cognito.user_pool_client_id
}

output "cognito_user_pool_endpoint" {
  value = module.cognito.user_pool_endpoint
}

output "cognito_domain" {
  value = module.cognito.cognito_domain
}

################################################################################
# ECS
################################################################################

output "ecs_cluster_arn" {
  value = module.ecs.cluster_arn
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_task_execution_role_arn" {
  value = module.ecs.task_execution_role_arn
}

output "splitter_alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "backend_service_name" {
  value = module.ecs.backend_service_name
}

output "public_alb_dns_name" {
  value = module.ecs.public_alb_dns_name
}

################################################################################
# Lambda (created in root main.tf)
################################################################################

output "lambda_execution_role_arn" {
  value = aws_iam_role.lambda_exec.arn
}

output "lambda_security_group_id" {
  value = aws_security_group.lambda.id
}

output "lyrics_generator_function_name" {
  value = aws_lambda_function.lyrics_generator.function_name
}

output "lyrics_generator_function_arn" {
  value = aws_lambda_function.lyrics_generator.arn
}


output "chords_generator_function_name" {
  value = aws_lambda_function.chords_generator.function_name
}

output "chords_generator_function_arn" {
  value = aws_lambda_function.chords_generator.arn
}

output "demucs_function_name" {
  value = aws_lambda_function.demucs.function_name
}

output "demucs_function_arn" {
  value = aws_lambda_function.demucs.arn
}

output "job_orchestrator_function_name" {
  value = aws_lambda_function.job_orchestrator.function_name
}

output "job_orchestrator_alias_arn" {
  value = aws_lambda_alias.job_orchestrator_live.arn
}

output "vocals_guitar_stitch_function_name" {
  value = aws_lambda_function.vocals_guitar_stitch.function_name
}

output "vocals_guitar_stitch_alias_arn" {
  value = aws_lambda_alias.vocals_guitar_stitch_live.arn
}

output "stale_job_sweeper_function_name" {
  value = aws_lambda_function.stale_job_sweeper.function_name
}

output "stale_job_sweeper_alias_arn" {
  value = aws_lambda_alias.stale_job_sweeper_live.arn
}

output "unconfirmed_user_cleanup_function_name" {
  value = aws_lambda_function.unconfirmed_user_cleanup.function_name
}

output "unconfirmed_user_cleanup_alias_arn" {
  value = aws_lambda_alias.unconfirmed_user_cleanup_live.arn
}

output "ecr_unconfirmed_user_cleanup_repo_url" {
  value = module.ecr.unconfirmed_user_cleanup_repo_url
}

################################################################################
# SQS
################################################################################

output "youtube_download_queue_url" {
  value = aws_sqs_queue.youtube_download.id
}

output "youtube_download_queue_arn" {
  value = aws_sqs_queue.youtube_download.arn
}

################################################################################
# DNS / SSL
################################################################################

output "acm_certificate_arn" {
  value = module.dns.acm_certificate_arn
}

output "route53_hosted_zone_id" {
  value = module.dns.public_hosted_zone_id
}

################################################################################
# General
################################################################################

output "aws_region" {
  value = var.aws_region
}

output "environment" {
  value = var.environment
}

output "project_name" {
  value = var.project_name
}

output "domain_name" {
  value = var.domain_name
}
