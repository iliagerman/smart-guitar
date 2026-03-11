#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

backend_dir="${project_dir}/backend"

region="$(read_output aws_region)"

prepare_secrets "${backend_dir}" "${backend_dir}/config/prod.secrets.yml"

build_and_push() {
  local name="$1"
  local ecr_key="$2"
  local dockerfile_rel="$3"

  local repo_url="$(read_output "${ecr_key}")"
  local image_uri="${repo_url}:latest"

  echo "==> [${name}] Building..."
  docker build \
    --platform linux/amd64 \
    -f "${backend_dir}/${dockerfile_rel}" \
    -t "${image_uri}" \
    "${backend_dir}"

  if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
    local registry
    registry="${repo_url%%/*}"
    ecr_login "${region}" "${registry}"
  fi

  echo "==> [${name}] Pushing..."
  docker push "${image_uri}"
}

build_and_push "job-orchestrator" "ecr_job_orchestrator_repo_url" "Dockerfile.job-orchestrator"
build_and_push "vocals-guitar-stitch" "ecr_vocals_guitar_stitch_repo_url" "Dockerfile.vocals-guitar-stitch"
build_and_push "stale-job-sweeper" "ecr_stale_job_sweeper_repo_url" "Dockerfile.stale-job-sweeper"
build_and_push "unconfirmed-user-cleanup" "ecr_unconfirmed_user_cleanup_repo_url" "Dockerfile.unconfirmed-user-cleanup"

tabs_repo_url="$(read_output "ecr_tabs_generator_repo_url")"
tabs_image_uri="${tabs_repo_url}:latest"

echo "==> [tabs-generator] Building..."
docker build \
  --platform linux/amd64 \
  -f "${project_dir}/tabs_generator/Dockerfile" \
  -t "${tabs_image_uri}" \
  "${project_dir}/tabs_generator"

if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  tabs_registry="${tabs_repo_url%%/*}"
  ecr_login "${region}" "${tabs_registry}"
fi

echo "==> [tabs-generator] Pushing..."
docker push "${tabs_image_uri}"

echo "==> Worker images pushed."
