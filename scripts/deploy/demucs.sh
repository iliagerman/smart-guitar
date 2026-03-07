#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

demucs_dir="${project_dir}/inference_demucs"

repo_url="$(read_output ecr_inference_demucs_repo_url)"
function_name="$(read_output demucs_function_name)"
region="$(read_output aws_region)"

registry="${repo_url%%/*}"
if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${registry}"
fi

unset DOCKERFILE
unset DOCKER_BUILD_ARGS

deploy_lambda_container_image "demucs" "${demucs_dir}" "${repo_url}" "${function_name}" "${region}"

git_tag "demucs_prod"

echo "Endpoint: http://splitter.smart-guitar.com (from within VPC)"
