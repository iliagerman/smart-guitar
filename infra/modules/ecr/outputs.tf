output "inference_demucs_repo_url" {
  value = aws_ecr_repository.repos["inference_demucs"].repository_url
}

output "inference_demucs_repo_arn" {
  value = aws_ecr_repository.repos["inference_demucs"].arn
}

output "backend_api_repo_url" {
  value = aws_ecr_repository.repos["backend_api"].repository_url
}

output "backend_api_repo_arn" {
  value = aws_ecr_repository.repos["backend_api"].arn
}


output "lyrics_generator_repo_url" {
  value = aws_ecr_repository.repos["lyrics_generator"].repository_url
}

output "lyrics_generator_repo_arn" {
  value = aws_ecr_repository.repos["lyrics_generator"].arn
}

output "chords_generator_repo_url" {
  value = aws_ecr_repository.repos["chords_generator"].repository_url
}

output "chords_generator_repo_arn" {
  value = aws_ecr_repository.repos["chords_generator"].arn
}

output "job_orchestrator_repo_url" {
  value = aws_ecr_repository.repos["job_orchestrator"].repository_url
}

output "job_orchestrator_repo_arn" {
  value = aws_ecr_repository.repos["job_orchestrator"].arn
}

output "vocals_guitar_stitch_repo_url" {
  value = aws_ecr_repository.repos["vocals_guitar_stitch"].repository_url
}

output "vocals_guitar_stitch_repo_arn" {
  value = aws_ecr_repository.repos["vocals_guitar_stitch"].arn
}

output "stale_job_sweeper_repo_url" {
  value = aws_ecr_repository.repos["stale_job_sweeper"].repository_url
}

output "stale_job_sweeper_repo_arn" {
  value = aws_ecr_repository.repos["stale_job_sweeper"].arn
}

output "unconfirmed_user_cleanup_repo_url" {
  value = aws_ecr_repository.repos["unconfirmed_user_cleanup"].repository_url
}

output "unconfirmed_user_cleanup_repo_arn" {
  value = aws_ecr_repository.repos["unconfirmed_user_cleanup"].arn
}
