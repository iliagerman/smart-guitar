provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

################################################################################
# Modules
################################################################################

module "networking" {
  source = "./modules/networking"

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags
}

module "dns" {
  source = "./modules/dns"

  domain_name    = var.domain_name
  hosted_zone_id = var.hosted_zone_id
  vpc_id         = module.networking.vpc_id
  tags           = local.common_tags
}

module "ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  tags         = local.common_tags
}

module "cognito" {
  source = "./modules/cognito"

  project_name         = var.project_name
  domain_name          = var.domain_name
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
  certificate_arn      = module.dns.acm_certificate_validation_arn
  hosted_zone_id       = module.dns.public_hosted_zone_id
  tags                 = local.common_tags
}

module "storage" {
  source = "./modules/storage"

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  audio_cors_allowed_origins = [
    "https://${local.app_domain}",
    "http://localhost:5173",
  ]
}

module "database" {
  source = "./modules/database"

  project_name            = var.project_name
  environment             = var.environment
  aws_region              = var.aws_region
  vpc_id                  = module.networking.vpc_id
  private_data_subnet_ids = module.networking.private_data_subnet_ids
  db_instance_class       = var.db_instance_class
  tags                    = local.common_tags
}

module "ecs" {
  source = "./modules/ecs"

  project_name                = var.project_name
  environment                 = var.environment
  vpc_id                      = module.networking.vpc_id
  vpc_cidr                    = module.networking.vpc_cidr_block
  private_app_subnet_ids      = module.networking.private_app_subnet_ids
  public_subnet_ids           = module.networking.public_subnet_ids
  certificate_arn             = module.dns.acm_certificate_validation_arn
  ecr_backend_api_repo_arn    = module.ecr.backend_api_repo_arn
  ecr_backend_api_repo_url    = module.ecr.backend_api_repo_url
  audio_bucket_arn            = module.storage.audio_bucket_arn
  cognito_user_pool_id        = module.cognito.user_pool_id
  cognito_client_id           = module.cognito.user_pool_client_id
  job_orchestrator_invoke_arn = aws_lambda_alias.job_orchestrator_live.arn
  youtube_download_queue_arn  = aws_sqs_queue.youtube_download.arn
  youtube_download_queue_url  = aws_sqs_queue.youtube_download.id
  tags                        = local.common_tags
}

module "cdn" {
  source = "./modules/cdn"

  project_name                         = var.project_name
  environment                          = var.environment
  frontend_bucket_name                 = module.storage.frontend_bucket_name
  frontend_bucket_arn                  = module.storage.frontend_bucket_arn
  frontend_bucket_regional_domain_name = module.storage.frontend_bucket_regional_domain_name
  acm_certificate_arn                  = module.dns.acm_certificate_validation_arn
  domain_aliases                       = [local.app_domain]
  landing_bucket_name                  = module.storage.landing_bucket_name
  landing_bucket_arn                   = module.storage.landing_bucket_arn
  landing_bucket_regional_domain_name  = module.storage.landing_bucket_regional_domain_name
  landing_domain_aliases               = [var.domain_name, "www.${var.domain_name}"]
  tags                                 = local.common_tags
}

################################################################################
# Lambda Security Group (no Lambda module, so created here)
################################################################################

resource "aws_security_group" "lambda" {
  name_prefix = "${var.project_name}-lambda-"
  description = "Lambda function security group"
  vpc_id      = module.networking.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-lambda-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

################################################################################
# Security Group Wiring
################################################################################

resource "aws_security_group_rule" "rds_from_backend_ecs" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  description              = "PostgreSQL from backend ECS tasks"
  security_group_id        = module.database.rds_security_group_id
  source_security_group_id = module.ecs.backend_security_group_id
}

resource "aws_security_group_rule" "rds_from_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  description              = "PostgreSQL from Lambda"
  security_group_id        = module.database.rds_security_group_id
  source_security_group_id = aws_security_group.lambda.id
}

################################################################################
# Lambda IAM Role (no Lambda module, so created here)
################################################################################

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_app" {
  name = "app-permissions"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Audio"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          module.storage.audio_bucket_arn,
          "${module.storage.audio_bucket_arn}/*"
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${local.account_id}:*"
      },
      {
        Sid    = "ECRPull"
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = [

          module.ecr.lyrics_generator_repo_arn,
          module.ecr.chords_generator_repo_arn,
          module.ecr.inference_demucs_repo_arn,
          module.ecr.job_orchestrator_repo_arn,
          module.ecr.vocals_guitar_stitch_repo_arn,
          module.ecr.stale_job_sweeper_repo_arn,
          module.ecr.unconfirmed_user_cleanup_repo_arn
        ]
      },
      {
        Sid    = "InvokeVocalsGuitarStitch"
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.vocals_guitar_stitch.arn,
          "${aws_lambda_function.vocals_guitar_stitch.arn}:*"
        ]
      },
      {
        Sid    = "CognitoUserManagement"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminDeleteUser"
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${local.account_id}:userpool/${module.cognito.user_pool_id}"
      },
      {
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/*",
          "arn:aws:bedrock:${var.aws_region}:${local.account_id}:inference-profile/*"
        ]
      }
    ]
  })
}

################################################################################
# Lyrics Generator Lambda
################################################################################

resource "aws_cloudwatch_log_group" "lyrics_generator" {
  name              = "/aws/lambda/${var.project_name}-lyrics-generator"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "lyrics_generator" {
  function_name = "${var.project_name}-lyrics-generator"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.lyrics_generator_repo_url}:latest"
  timeout       = 900
  memory_size   = 8192
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  ephemeral_storage {
    size = 2048
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "lyrics_generator_live" {
  name             = "live"
  function_name    = aws_lambda_function.lyrics_generator.function_name
  function_version = aws_lambda_function.lyrics_generator.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_lambda_provisioned_concurrency_config" "lyrics_generator" {
  function_name                     = aws_lambda_function.lyrics_generator.function_name
  qualifier                         = aws_lambda_alias.lyrics_generator_live.name
  provisioned_concurrent_executions = 1
}

################################################################################
# Lyrics Generator — ALB Integration
################################################################################

resource "aws_lb_target_group" "lyrics" {
  name        = "${var.project_name}-lyrics-tg"
  target_type = "lambda"
  tags        = local.common_tags
}

resource "aws_lb_target_group_attachment" "lyrics" {
  target_group_arn = aws_lb_target_group.lyrics.arn
  target_id        = aws_lambda_alias.lyrics_generator_live.arn
  depends_on       = [aws_lambda_permission.lyrics_alb]
}

resource "aws_lambda_permission" "lyrics_alb" {
  statement_id  = "AllowALBInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lyrics_generator.function_name
  qualifier     = aws_lambda_alias.lyrics_generator_live.name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.lyrics.arn
}

resource "aws_lb_listener_rule" "lyrics" {
  listener_arn = module.ecs.alb_listener_arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.lyrics.arn
  }

  condition {
    host_header {
      values = [local.lyrics_domain]
    }
  }
}

################################################################################
# Chords Generator Lambda
################################################################################

resource "aws_cloudwatch_log_group" "chords_generator" {
  name              = "/aws/lambda/${var.project_name}-chords-generator"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "chords_generator" {
  function_name = "${var.project_name}-chords-generator"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.chords_generator_repo_url}:latest"
  timeout       = 600
  memory_size   = 6144
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  ephemeral_storage {
    size = 2048
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "chords_generator_live" {
  name             = "live"
  function_name    = aws_lambda_function.chords_generator.function_name
  function_version = aws_lambda_function.chords_generator.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_lambda_provisioned_concurrency_config" "chords_generator" {
  function_name                     = aws_lambda_function.chords_generator.function_name
  qualifier                         = aws_lambda_alias.chords_generator_live.name
  provisioned_concurrent_executions = 1
}

################################################################################
# Chords Generator — ALB Integration
################################################################################

resource "aws_lb_target_group" "chords" {
  name        = "${var.project_name}-chords-tg"
  target_type = "lambda"
  tags        = local.common_tags
}

resource "aws_lb_target_group_attachment" "chords" {
  target_group_arn = aws_lb_target_group.chords.arn
  target_id        = aws_lambda_alias.chords_generator_live.arn
  depends_on       = [aws_lambda_permission.chords_alb]
}

resource "aws_lambda_permission" "chords_alb" {
  statement_id  = "AllowALBInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.chords_generator.function_name
  qualifier     = aws_lambda_alias.chords_generator_live.name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.chords.arn
}

resource "aws_lb_listener_rule" "chords" {
  listener_arn = module.ecs.alb_listener_arn
  priority     = 300

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.chords.arn
  }

  condition {
    host_header {
      values = [local.chords_domain]
    }
  }
}

################################################################################
# Demucs (Stem Separation) Lambda
################################################################################

resource "aws_cloudwatch_log_group" "demucs" {
  name              = "/aws/lambda/${var.project_name}-demucs"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "demucs" {
  function_name = "${var.project_name}-demucs"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.inference_demucs_repo_url}:latest"
  timeout       = 900
  memory_size   = 10240
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  ephemeral_storage {
    size = 3072
  }

  environment {
    variables = {
      # Lambda Web Adapter: confirm FastAPI lifespan is complete before forwarding requests
      READINESS_CHECK_PATH = "/health"
    }
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "demucs_live" {
  name             = "live"
  function_name    = aws_lambda_function.demucs.function_name
  function_version = aws_lambda_function.demucs.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_lambda_provisioned_concurrency_config" "demucs" {
  function_name                     = aws_lambda_function.demucs.function_name
  qualifier                         = aws_lambda_alias.demucs_live.name
  provisioned_concurrent_executions = 1
}

################################################################################
# Demucs — ALB Integration
################################################################################

resource "aws_lb_target_group" "demucs" {
  name        = "${var.project_name}-demucs-lambda-tg"
  target_type = "lambda"
  tags        = local.common_tags
}

resource "aws_lb_target_group_attachment" "demucs" {
  target_group_arn = aws_lb_target_group.demucs.arn
  target_id        = aws_lambda_alias.demucs_live.arn
  depends_on       = [aws_lambda_permission.demucs_alb]
}

resource "aws_lambda_permission" "demucs_alb" {
  statement_id  = "AllowALBInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.demucs.function_name
  qualifier     = aws_lambda_alias.demucs_live.name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.demucs.arn
}

resource "aws_lb_listener_rule" "demucs" {
  listener_arn = module.ecs.alb_listener_arn
  priority     = 50

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.demucs.arn
  }

  condition {
    host_header {
      values = [local.splitter_domain]
    }
  }
}

################################################################################
# Job Orchestrator Lambda (invoked by backend ECS)
################################################################################

resource "aws_cloudwatch_log_group" "job_orchestrator" {
  name              = "/aws/lambda/${var.project_name}-job-orchestrator"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "job_orchestrator" {
  function_name = "${var.project_name}-job-orchestrator"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.job_orchestrator_repo_url}:latest"
  timeout       = 900
  memory_size   = 4096
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  ephemeral_storage {
    size = 4096
  }

  environment {
    variables = {
      VOCALS_GUITAR_STITCH_FUNCTION_NAME = aws_lambda_alias.vocals_guitar_stitch_live.arn
    }
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "job_orchestrator_live" {
  name             = "live"
  function_name    = aws_lambda_function.job_orchestrator.function_name
  function_version = aws_lambda_function.job_orchestrator.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_lambda_provisioned_concurrency_config" "job_orchestrator" {
  function_name                     = aws_lambda_function.job_orchestrator.function_name
  qualifier                         = aws_lambda_alias.job_orchestrator_live.name
  provisioned_concurrent_executions = 1
}

################################################################################
# Vocals+Guitar Stitch Lambda (invoked by orchestrator)
################################################################################

resource "aws_cloudwatch_log_group" "vocals_guitar_stitch" {
  name              = "/aws/lambda/${var.project_name}-vocals-guitar-stitch"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "vocals_guitar_stitch" {
  function_name = "${var.project_name}-vocals-guitar-stitch"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.vocals_guitar_stitch_repo_url}:latest"
  timeout       = 300
  memory_size   = 2048
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  ephemeral_storage {
    size = 2048
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "vocals_guitar_stitch_live" {
  name             = "live"
  function_name    = aws_lambda_function.vocals_guitar_stitch.function_name
  function_version = aws_lambda_function.vocals_guitar_stitch.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_lambda_provisioned_concurrency_config" "vocals_guitar_stitch" {
  function_name                     = aws_lambda_function.vocals_guitar_stitch.function_name
  qualifier                         = aws_lambda_alias.vocals_guitar_stitch_live.name
  provisioned_concurrent_executions = 1
}

################################################################################
# Stale Job Sweeper Lambda (invoked by EventBridge)
################################################################################

resource "aws_cloudwatch_log_group" "stale_job_sweeper" {
  name              = "/aws/lambda/${var.project_name}-stale-job-sweeper"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "stale_job_sweeper" {
  function_name = "${var.project_name}-stale-job-sweeper"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.stale_job_sweeper_repo_url}:latest"
  timeout       = 300
  memory_size   = 512
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)
  environment {
    variables = {
      YOUTUBE_DOWNLOAD_QUEUE_URL = aws_sqs_queue.youtube_download.id
    }
  }

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "stale_job_sweeper_live" {
  name             = "live"
  function_name    = aws_lambda_function.stale_job_sweeper.function_name
  function_version = aws_lambda_function.stale_job_sweeper.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_cloudwatch_event_rule" "stale_job_sweeper" {
  name                = "${var.project_name}-stale-job-sweeper"
  schedule_expression = "rate(2 minutes)"
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "stale_job_sweeper" {
  rule       = aws_cloudwatch_event_rule.stale_job_sweeper.name
  arn        = aws_lambda_alias.stale_job_sweeper_live.arn
  depends_on = [aws_lambda_permission.stale_job_sweeper_events]
}

resource "aws_lambda_permission" "stale_job_sweeper_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.stale_job_sweeper.function_name
  qualifier     = aws_lambda_alias.stale_job_sweeper_live.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.stale_job_sweeper.arn
}

################################################################################
# Unconfirmed User Cleanup Lambda
################################################################################

resource "aws_cloudwatch_log_group" "unconfirmed_user_cleanup" {
  name              = "/aws/lambda/${var.project_name}-unconfirmed-user-cleanup"
  retention_in_days = 3
  tags              = local.common_tags
}

resource "aws_lambda_function" "unconfirmed_user_cleanup" {
  function_name = "${var.project_name}-unconfirmed-user-cleanup"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.unconfirmed_user_cleanup_repo_url}:latest"
  timeout       = 120
  memory_size   = 512
  publish       = true

  logging_config {
    log_format = "JSON"
  }

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)

  tags = local.common_tags

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_alias" "unconfirmed_user_cleanup_live" {
  name             = "live"
  function_name    = aws_lambda_function.unconfirmed_user_cleanup.function_name
  function_version = aws_lambda_function.unconfirmed_user_cleanup.version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

resource "aws_cloudwatch_event_rule" "unconfirmed_user_cleanup" {
  name                = "${var.project_name}-unconfirmed-user-cleanup"
  schedule_expression = "rate(6 hours)"
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "unconfirmed_user_cleanup" {
  rule       = aws_cloudwatch_event_rule.unconfirmed_user_cleanup.name
  arn        = aws_lambda_alias.unconfirmed_user_cleanup_live.arn
  depends_on = [aws_lambda_permission.unconfirmed_user_cleanup_events]
}

resource "aws_lambda_permission" "unconfirmed_user_cleanup_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.unconfirmed_user_cleanup.function_name
  qualifier     = aws_lambda_alias.unconfirmed_user_cleanup_live.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.unconfirmed_user_cleanup.arn
}

################################################################################
# YouTube Download SQS Queue (consumed by homeserver)
################################################################################

resource "aws_sqs_queue" "youtube_download" {
  name                       = "${var.project_name}-youtube-download"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20
  tags                       = local.common_tags
}

resource "aws_sqs_queue" "youtube_download_dlq" {
  name                      = "${var.project_name}-youtube-download-dlq"
  message_retention_seconds = 604800
  tags                      = local.common_tags
}

resource "aws_sqs_queue_redrive_policy" "youtube_download" {
  queue_url = aws_sqs_queue.youtube_download.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.youtube_download_dlq.arn
    maxReceiveCount     = 3
  })
}

################################################################################
# IAM User for Homeserver (SQS consume + S3 upload only)
################################################################################

resource "aws_iam_user" "homeserver" {
  name = "${var.project_name}-homeserver"
  tags = local.common_tags
}

resource "aws_iam_user_policy" "homeserver" {
  name = "homeserver-sqs-s3"
  user = aws_iam_user.homeserver.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.youtube_download.arn
      },
      {
        Sid    = "S3Upload"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:HeadObject"
        ]
        Resource = "${module.storage.audio_bucket_arn}/*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "${aws_cloudwatch_log_group.homeserver_youtube_downloader.arn}:*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "homeserver_youtube_downloader" {
  name              = "/homeserver/${var.project_name}-youtube-downloader"
  retention_in_days = 3
  tags              = local.common_tags
}

################################################################################
# Route53 Records
################################################################################

# app.smart-guitar.com → CloudFront
resource "aws_route53_record" "app" {
  zone_id = module.dns.public_hosted_zone_id
  name    = local.app_domain
  type    = "A"

  alias {
    name                   = module.cdn.distribution_domain_name
    zone_id                = module.cdn.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# smart-guitar.com → CloudFront (landing page)
resource "aws_route53_record" "landing" {
  zone_id = module.dns.public_hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.cdn.landing_distribution_domain_name
    zone_id                = module.cdn.landing_distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# www.smart-guitar.com → CloudFront (landing page)
resource "aws_route53_record" "landing_www" {
  zone_id = module.dns.public_hosted_zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = module.cdn.landing_distribution_domain_name
    zone_id                = module.cdn.landing_distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# api.smart-guitar.com → Public ALB (public zone)
resource "aws_route53_record" "api" {
  zone_id = module.dns.public_hosted_zone_id
  name    = local.api_domain
  type    = "A"

  alias {
    name                   = module.ecs.public_alb_dns_name
    zone_id                = module.ecs.public_alb_zone_id
    evaluate_target_health = true
  }
}

# splitter.smart-guitar.com → Internal ALB (private zone)
resource "aws_route53_record" "splitter" {
  zone_id = module.dns.private_hosted_zone_id
  name    = local.splitter_domain
  type    = "A"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}

# lyrics.smart-guitar.com → Internal ALB (private zone)
resource "aws_route53_record" "lyrics" {
  zone_id = module.dns.private_hosted_zone_id
  name    = local.lyrics_domain
  type    = "A"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}

# chords.smart-guitar.com → Internal ALB (private zone)
resource "aws_route53_record" "chords" {
  zone_id = module.dns.private_hosted_zone_id
  name    = local.chords_domain
  type    = "A"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}


