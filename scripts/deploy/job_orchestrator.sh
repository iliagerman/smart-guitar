#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

backend_dir="${project_dir}/backend"

repo_url="$(read_output ecr_job_orchestrator_repo_url)"
function_name="$(read_output job_orchestrator_function_name)"
region="$(read_output aws_region)"

registry="${repo_url%%/*}"
if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${registry}"
fi

prepare_secrets "${backend_dir}" "${backend_dir}/config/prod.secrets.yml"

export DOCKERFILE="${backend_dir}/Dockerfile.job-orchestrator"
unset DOCKER_BUILD_ARGS

deploy_lambda_container_image "job-orchestrator" "${backend_dir}" "${repo_url}" "${function_name}" "${region}"

git_tag "job_orchestrator_prod"
