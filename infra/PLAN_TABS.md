# Infrastructure Plan: Tabs Generator Lambda Deployment

## Context

The `tabs_generator` microservice uses Spotify's basic-pitch model (~10MB TF-Lite) to transcribe guitar notes from audio. The total container image is ~200MB with all dependencies, and inference takes 30-60 seconds for typical 3-6 minute songs. This makes it a good fit for **AWS Lambda** (container image deployment) rather than ECS Fargate, keeping costs minimal.

The existing infrastructure already has a Lambda execution role (`aws_iam_role.lambda_exec`), security group (`aws_security_group.lambda`), and VPC wiring for Lambda functions. We reuse all of these.

---

## 1. ECR Repository

**File**: `infra/modules/ecr/main.tf`

Add `tabs_generator` to the existing `local.repositories` map:

```hcl
locals {
  repositories = {
    inference_demucs = "${var.project_name}-inference-demucs"
    backend_api      = "${var.project_name}-backend-api"
    tabs_generator   = "${var.project_name}-tabs-generator"   # NEW
  }
}
```

The existing `aws_ecr_repository.repos` and `aws_ecr_lifecycle_policy.repos` resources use `for_each` over this map, so the new repo is created automatically.

---

## 2. ECR Outputs

**File**: `infra/modules/ecr/outputs.tf`

Add outputs for the new repo:

```hcl
output "tabs_generator_repo_url" {
  value = aws_ecr_repository.repos["tabs_generator"].repository_url
}

output "tabs_generator_repo_arn" {
  value = aws_ecr_repository.repos["tabs_generator"].arn
}
```

---

## 3. Lambda Function

**File**: `infra/main.tf`

Add after the existing Lambda IAM role section (~line 218):

### 3a. CloudWatch Log Group

```hcl
resource "aws_cloudwatch_log_group" "tabs_generator" {
  name              = "/aws/lambda/${var.project_name}-tabs-generator"
  retention_in_days = 30
  tags              = local.common_tags
}
```

### 3b. Lambda Function

```hcl
resource "aws_lambda_function" "tabs_generator" {
  function_name = "${var.project_name}-tabs-generator"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${module.ecr.tabs_generator_repo_url}:latest"
  timeout       = 300   # 5 min for longer audio files
  memory_size   = 1024  # basic-pitch CPU inference needs decent memory

  vpc_config {
    subnet_ids         = module.networking.private_app_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      APP_ENV = var.environment
    }
  }

  tags = local.common_tags
}
```

Key settings:
- **timeout: 300s** — basic-pitch inference on a 5-minute song takes ~30-60s; 300s provides ample headroom
- **memory_size: 1024MB** — TF-Lite model + audio processing needs decent memory; 1GB is sufficient
- **package_type: Image** — uses the Docker container from ECR (includes ffmpeg, libsndfile, basic-pitch model)
- **VPC**: Same private subnets and Lambda security group as the backend Lambda, for S3 access

### 3c. ECR Pull Permission

The existing `aws_iam_role.lambda_exec` already has S3, SecretsManager, and CloudWatch permissions. Add ECR pull permission if not covered by the execution role's managed policy. The `AWSLambdaVPCAccessExecutionRole` managed policy (already attached) covers basic execution. ECR pull is handled automatically by Lambda for container images when the execution role has `ecr:GetDownloadUrlForLayer` and `ecr:BatchGetImage`.

If needed, add to the existing `aws_iam_role_policy.lambda_app`:

```hcl
{
  Sid    = "ECRPull"
  Effect = "Allow"
  Action = [
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
    "ecr:BatchCheckLayerAvailability"
  ]
  Resource = [module.ecr.tabs_generator_repo_arn]
}
```

---

## 4. Fallback: ECS Fargate

If Lambda's 300-second timeout proves insufficient for very long audio files (>10 minutes), the fallback is:
- Add an ECS task definition + service in `infra/modules/ecs/main.tf` (same pattern as inference_demucs)
- Add an ALB target group on port 8004
- Update ALB listener rules
- No code changes needed — the same Docker image and API work on both Lambda and ECS

---

## Files to Modify

| File | Change |
|------|--------|
| `infra/modules/ecr/main.tf` | Add `tabs_generator` to `local.repositories` |
| `infra/modules/ecr/outputs.tf` | Add `tabs_generator_repo_url` and `tabs_generator_repo_arn` |
| `infra/main.tf` | Add CloudWatch log group + Lambda function + optional ECR pull policy |

---

## Verification

1. `cd infra && terraform plan -var-file=environments/dev.tfvars` — verify new resources in plan:
   - `aws_ecr_repository.repos["tabs_generator"]`
   - `aws_ecr_lifecycle_policy.repos["tabs_generator"]`
   - `aws_cloudwatch_log_group.tabs_generator`
   - `aws_lambda_function.tabs_generator`
2. `just deploy-infra` — apply changes
3. Verify ECR repo exists: `aws ecr describe-repositories --repository-names guitar-player-tabs-generator`
4. Build and push Docker image: `docker build -t tabs-generator tabs_generator/ && docker tag ... && docker push ...`
5. Verify Lambda function exists: `aws lambda get-function --function-name guitar-player-tabs-generator`
