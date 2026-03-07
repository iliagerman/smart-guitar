#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

backend_dir="${project_dir}/backend"
region="$(read_output aws_region)"
repo_url="$(read_output ecr_job_orchestrator_repo_url)"
image_uri="${repo_url}:latest"

if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${repo_url%%/*}"
fi

echo "==> Building orchestrator image..."
docker build \
  --platform linux/amd64 \
  -f "${backend_dir}/Dockerfile.job-orchestrator" \
  -t "${image_uri}" \
  "${backend_dir}"

echo "==> Pushing image to ECR..."
docker push "${image_uri}"
