#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/deploy/infra.sh apply
#   scripts/deploy/infra.sh destroy
#   scripts/deploy/infra.sh validate
#   scripts/deploy/infra.sh bootstrap-workers

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

cmd="${1:-}"
if [[ -z "${cmd}" ]]; then
  echo "Usage: infra.sh <apply|destroy|validate|bootstrap-workers>" >&2
  exit 2
fi

infra_dir="${project_dir}/infra"

load_aws_env_from_secrets_if_missing
load_tf_google_vars_from_secrets

case "${cmd}" in
  apply)
    cd "${infra_dir}" && terraform init -input=false

    # 1. Ensure ECR repos exist (fast no-op when they already do).
    echo "==> Step 1/4: Ensuring ECR repos..."
    cd "${infra_dir}" && terraform apply -auto-approve -var-file=environments/prod.tfvars -target=module.ecr
    cd "${infra_dir}" && terraform output -json > "${project_dir}/infra-outputs.json"

    # 2. Build & push worker images so Lambdas can initialise.
    echo "==> Step 2/4: Building and pushing worker images..."
    bash "${project_dir}/scripts/deploy/push_worker_images.sh"

    # 3. Update existing worker Lambdas to use the latest images.
    #    Deploy scripts own code/version/alias management; Terraform ignores
    #    image_uri and function_version via lifecycle ignore_changes.
    #    On first deploy the functions don't exist yet and are silently skipped.
    echo "==> Step 3/4: Refreshing worker Lambdas (if they exist)..."
    refresh_worker_lambdas

    # 4. Full Terraform apply (infra config only — code is managed by scripts).
    echo "==> Step 4/4: Full Terraform apply..."
    cd "${infra_dir}" && terraform apply -auto-approve -var-file=environments/prod.tfvars
    cd "${infra_dir}" && terraform output -json > "${project_dir}/infra-outputs.json"
    ;;

  destroy)
    cd "${infra_dir}" && terraform init -input=false
    cd "${infra_dir}" && terraform destroy -var-file=environments/prod.tfvars
    ;;

  validate)
    cd "${infra_dir}" && terraform init -input=false
    cd "${infra_dir}" && terraform validate
    ;;

  *)
    echo "Unknown command: ${cmd}" >&2
    exit 2
    ;;
esac
