locals {
  repositories = {
    inference_demucs = "${var.project_name}-inference-demucs"
    backend_api      = "${var.project_name}-backend-api"
lyrics_generator = "${var.project_name}-lyrics-generator"
    chords_generator = "${var.project_name}-chords-generator"

    job_orchestrator         = "${var.project_name}-job-orchestrator"
    vocals_guitar_stitch     = "${var.project_name}-vocals-guitar-stitch"
    stale_job_sweeper        = "${var.project_name}-stale-job-sweeper"
    unconfirmed_user_cleanup = "${var.project_name}-unconfirmed-user-cleanup"
  }
}

resource "aws_ecr_repository" "repos" {
  for_each = local.repositories

  name                 = each.value
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "repos" {
  for_each = local.repositories

  repository = aws_ecr_repository.repos[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
