#!/usr/bin/env bash
set -euo pipefail

# Optional env:
#   WHISPER_MODEL (default: medium)

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

lyrics_dir="${project_dir}/lyrics_generator"

repo_url="$(read_output ecr_lyrics_generator_repo_url)"
function_name="$(read_output lyrics_generator_function_name)"
region="$(read_output aws_region)"

registry="${repo_url%%/*}"
if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${registry}"
fi

whisper_model="${WHISPER_MODEL:-medium}"

prepare_secrets "${lyrics_dir}" "${lyrics_dir}/secrets.yml"

export DOCKER_BUILD_ARGS="--build-arg WHISPER_MODEL=${whisper_model}"
unset DOCKERFILE

deploy_lambda_container_image "lyrics" "${lyrics_dir}" "${repo_url}" "${function_name}" "${region}"

git_tag "lyrics_prod"

echo "Endpoint: http://lyrics.smart-guitar.com (from within VPC)"
