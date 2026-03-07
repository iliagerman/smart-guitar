#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

backend_dir="${project_dir}/backend"

repo_url="$(read_output ecr_vocals_guitar_stitch_repo_url)"
function_name="$(read_output vocals_guitar_stitch_function_name)"
region="$(read_output aws_region)"

registry="${repo_url%%/*}"
if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${registry}"
fi

prepare_secrets "${backend_dir}" "${backend_dir}/config/prod.secrets.yml"

export DOCKERFILE="${backend_dir}/Dockerfile.vocals-guitar-stitch"
unset DOCKER_BUILD_ARGS

deploy_lambda_container_image "vocals-guitar-stitch" "${backend_dir}" "${repo_url}" "${function_name}" "${region}"

git_tag "vocals_guitar_stitch_prod"
