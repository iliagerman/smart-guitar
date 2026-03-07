data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  app_domain      = "app.${var.domain_name}"
  api_domain      = "api.${var.domain_name}"
  splitter_domain = "splitter.${var.domain_name}"
  auth_domain     = "auth.${var.domain_name}"
  lyrics_domain   = "lyrics.${var.domain_name}"
  chords_domain   = "chords.${var.domain_name}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
