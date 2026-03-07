resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # ── Email verification for new registrations ──
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Smart Guitar - Verify your email"
    email_message        = "Welcome to Smart Guitar! Your verification code is: {####}"
  }

  email_configuration {
    email_sending_account  = "DEVELOPER"
    source_arn             = aws_ses_domain_identity.main.arn
    from_email_address     = "Smart Guitar <noreply@${var.domain_name}>"
  }

  tags = var.tags
}

# ── SES domain identity (for Cognito email via SES) ──

resource "aws_ses_domain_identity" "main" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_route53_record" "ses_verification" {
  zone_id = var.hosted_zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main.verification_token]
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = var.hosted_zone_id
  name    = "${aws_ses_domain_dkim.main.dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main.dkim_tokens[count.index]}.dkim.amazonses.com."]
}

resource "aws_ses_domain_identity_verification" "main" {
  domain     = aws_ses_domain_identity.main.id
  depends_on = [aws_route53_record.ses_verification]
}

# ── Cognito hosted UI domain (required for OAuth redirects) ──

resource "aws_cognito_user_pool_domain" "main" {
  domain          = "auth.${var.domain_name}"
  certificate_arn = var.certificate_arn
  user_pool_id    = aws_cognito_user_pool.main.id
}

# ── Google identity provider ──

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id                     = var.google_client_id
    client_secret                 = var.google_client_secret
    authorize_scopes              = "openid email profile"
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}

# ── Route53 record for the Cognito domain ──

resource "aws_route53_record" "cognito_auth" {
  zone_id = var.hosted_zone_id
  name    = "auth.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cognito_user_pool_domain.main.cloudfront_distribution
    zone_id                = "Z2FDTNDATAQYW2" # Fixed CloudFront hosted zone ID
    evaluate_target_health = false
  }
}

# ── User pool client ──

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Add Google as a supported identity provider
  supported_identity_providers = ["COGNITO", "Google"]

  callback_urls = [
    # Production web
    "https://app.${var.domain_name}",
    "https://app.${var.domain_name}/callback",
    # Local development
    "http://localhost:5173",
    "http://localhost:5173/callback",
    # Capacitor iOS
    "capacitor://localhost",
    "capacitor://localhost/callback",
    # Capacitor Android
    "http://localhost",
    "http://localhost/callback",
    # Custom deep link scheme
    "smartguitar://callback",
  ]

  logout_urls = [
    "https://app.${var.domain_name}",
    "http://localhost:5173",
    "capacitor://localhost",
    "http://localhost",
    "smartguitar://logout",
  ]

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true

  access_token_validity  = 1  # hours
  id_token_validity      = 1  # hours
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Google identity provider must exist before client references it
  depends_on = [aws_cognito_identity_provider.google]
}
