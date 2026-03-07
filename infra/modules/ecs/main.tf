################################################################################
# ECS Cluster
################################################################################

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 100
  }
}

################################################################################
# Internal ALB (used by Lambda services: demucs, tabs, lyrics, chords)
################################################################################

resource "aws_lb" "internal" {
  name               = "${var.project_name}-internal-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.private_app_subnet_ids

  idle_timeout               = 600 # 10 min — stem separation can take 4+ min
  enable_deletion_protection = false

  tags = merge(var.tags, { Name = "${var.project_name}-internal-alb" })
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = "{\"detail\":\"Not Found\"}"
      status_code  = "404"
    }
  }
}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  description = "Internal ALB security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "HTTP from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(var.tags, { Name = "${var.project_name}-alb-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

################################################################################
# IAM — Task Execution Role (shared by backend ECS service)
################################################################################

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_iam_role" "task_execution" {
  name = "${var.project_name}-ecs-task-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "task_execution_base" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_extra" {
  name = "ecr-auth"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })
}

################################################################################
# Public ALB — Backend API
################################################################################

resource "aws_security_group" "public_alb" {
  name_prefix = "${var.project_name}-public-alb-"
  description = "Public ALB security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from internet"
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP from internet (redirect to HTTPS)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(var.tags, { Name = "${var.project_name}-public-alb-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb" "public" {
  name               = "${var.project_name}-public-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.public_alb.id]
  subnets            = var.public_subnet_ids

  idle_timeout               = 300
  enable_deletion_protection = false

  tags = merge(var.tags, { Name = "${var.project_name}-public-alb" })
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-backend-tg"
  port        = 8002
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_listener" "public_https" {
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  # Default: reject anything not matching explicit allow rules above.
  # Legitimate traffic is forwarded by allow_api and allow_auth rules.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Not Found"
      status_code  = "404"
    }
  }
}

# Block vulnerability scanners and spam probes.
# ALB rules support up to 5 values per path_pattern condition.

resource "aws_lb_listener_rule" "block_php" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 1

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = ["*.php", "*.php*"]
    }
  }
}

resource "aws_lb_listener_rule" "block_scanners" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 2

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = [
        "/SDK/*",
        "/cgi-bin/*",
        "/vendor/*",
        "/wp-*",
        "/.env*",
      ]
    }
  }
}

resource "aws_lb_listener_rule" "block_scanners_2" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 3

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = [
        "/boaform/*",
        "/solr/*",
        "/actuator*",
        "/remote/*",
        "/hello.world*",
      ]
    }
  }
}

# Only allow traffic to /api/* and /health — reject everything else
resource "aws_lb_listener_rule" "allow_api" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/*", "/health"]
    }
  }
}

resource "aws_lb_listener_rule" "allow_auth" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 101

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/auth/*"]
    }
  }
}

resource "aws_lb_listener" "public_http_redirect" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

################################################################################
# CloudWatch Log Group — Backend API
################################################################################

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.project_name}-backend-api"
  retention_in_days = 3

  tags = var.tags
}

################################################################################
# Security Group — Backend ECS Tasks
################################################################################

resource "aws_security_group" "backend_tasks" {
  name_prefix = "${var.project_name}-backend-ecs-"
  description = "Backend ECS tasks security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 8002
    to_port         = 8002
    protocol        = "tcp"
    security_groups = [aws_security_group.public_alb.id]
    description     = "From public ALB only"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(var.tags, { Name = "${var.project_name}-backend-ecs-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

################################################################################
# IAM — Backend Task Role
################################################################################

resource "aws_iam_role" "backend_task" {
  name = "${var.project_name}-backend-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "backend_task_permissions" {
  name = "backend-app-permissions"
  role = aws_iam_role.backend_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
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
          var.audio_bucket_arn,
          "${var.audio_bucket_arn}/*"
        ]
      },
      {
        Sid    = "BedrockLLM"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = ["*"]
      }
      ], var.job_orchestrator_invoke_arn != "" ? [
      {
        Sid    = "InvokeJobOrchestrator"
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          var.job_orchestrator_invoke_arn
        ]
      }
    ] : [], var.youtube_download_queue_arn != "" ? [
      {
        Sid    = "SQSSendYoutubeDownload"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [
          var.youtube_download_queue_arn
        ]
      }
    ] : [])
  })
}

# Allow execution role to pull backend ECR image
resource "aws_iam_role_policy" "backend_execution_ecr" {
  name = "backend-ecr-pull"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = [var.ecr_backend_api_repo_arn]
      }
    ]
  })
}

################################################################################
# ECS Task Definition & Service — Backend API
################################################################################

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.project_name}-backend-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn

  container_definitions = jsonencode([
    {
      name      = "backend-api"
      image     = "${var.ecr_backend_api_repo_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 8002
          protocol      = "tcp"
        }
      ]

      environment = [
        # APP_ENV is set in the Dockerfile (ENV APP_ENV=prod)
        { name = "COGNITO_USER_POOL_ID", value = var.cognito_user_pool_id },
        { name = "COGNITO_CLIENT_ID", value = var.cognito_client_id },
        { name = "JOB_ORCHESTRATOR_FUNCTION_NAME", value = var.job_orchestrator_invoke_arn },
        { name = "YOUTUBE_DOWNLOAD_QUEUE_URL", value = var.youtube_download_queue_url },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "backend"
        }
      }
    },
    {
      name      = "yt-pot-provider"
      image     = "brainicism/bgutil-ytdlp-pot-provider:1.2.2"
      essential = true

      portMappings = [
        {
          containerPort = 4416
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "pot-provider"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "backend" {
  name            = "${var.project_name}-backend-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 100
  }

  network_configuration {
    subnets         = var.private_app_subnet_ids
    security_groups = [aws_security_group.backend_tasks.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend-api"
    container_port   = 8002
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  tags = var.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}

################################################################################
# Auto Scaling — Backend API
################################################################################

resource "aws_appautoscaling_target" "backend" {
  max_capacity       = 4
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${var.project_name}-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 50.0
    scale_in_cooldown  = 60
    scale_out_cooldown = 30

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "backend_memory" {
  name               = "${var.project_name}-backend-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 50.0
    scale_in_cooldown  = 60
    scale_out_cooldown = 30

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}
