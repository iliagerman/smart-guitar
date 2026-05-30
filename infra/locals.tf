data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  app_domain      = "app.${var.domain_name}"
  api_domain      = "api.${var.domain_name}"
  splitter_domain = "splitter.${var.domain_name}"
  auth_domain     = "auth.${var.domain_name}"
  lyrics_domain   = "lyrics.${var.domain_name}"
  chords_domain   = "chords.${var.domain_name}"
  tabs_domain     = "tabs.${var.domain_name}"
  media_domain    = "media.${var.domain_name}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  runtime_observer_env = {
    RUNTIME_OBSERVER_ENABLED      = "true"
    RUNTIME_OBSERVER_ENDPOINT     = var.runtime_observer_endpoint
    RUNTIME_OBSERVER_PROJECT_NAME = var.runtime_observer_project_name
    RUNTIME_OBSERVER_API_KEY      = var.runtime_observer_api_key
    RUNTIME_OBSERVER_CAPTURE_MODE = "prod"
    RUNTIME_OBSERVER_ENVIRONMENT  = var.environment == "prod" ? "production" : "development"
    RUNTIME_OBSERVER_LOG_LEVELS   = "WARNING,ERROR,CRITICAL"
  }
}
