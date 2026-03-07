variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "audio_bucket_arn" {
  type = string
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnets for the internet-facing ALB"
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate ARN for HTTPS listener"
}

variable "ecr_backend_api_repo_arn" {
  type        = string
  description = "ECR repo ARN for backend-api image"
}

variable "ecr_backend_api_repo_url" {
  type        = string
  description = "ECR repo URL for backend-api image"
}

variable "cognito_user_pool_id" {
  type        = string
  description = "Cognito User Pool ID for backend auth"
}

variable "cognito_client_id" {
  type        = string
  description = "Cognito User Pool Client ID"
}

variable "job_orchestrator_invoke_arn" {
  type        = string
  default     = ""
  description = "ARN (or alias ARN) of the job orchestrator Lambda to invoke from the backend"
}

variable "youtube_download_queue_arn" {
  type        = string
  default     = ""
  description = "ARN of the SQS queue for YouTube download requests (homeserver consumer)"
}

variable "youtube_download_queue_url" {
  type        = string
  default     = ""
  description = "URL of the SQS queue for YouTube download requests (passed as env var to backend)"
}

variable "tags" {
  type    = map(string)
  default = {}
}
