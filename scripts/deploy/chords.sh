#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

chords_dir="${project_dir}/chords_generator"

repo_url="$(read_output ecr_chords_generator_repo_url)"
function_name="$(read_output chords_generator_function_name)"
region="$(read_output aws_region)"

registry="${repo_url%%/*}"
if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${registry}"
fi

unset DOCKERFILE
unset DOCKER_BUILD_ARGS

deploy_lambda_container_image "chords" "${chords_dir}" "${repo_url}" "${function_name}" "${region}"

git_tag "chords_prod"

echo "Endpoint: http://chords.smart-guitar.com (from within VPC)"
