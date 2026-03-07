#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

backend_dir="${project_dir}/backend"

repo_url="$(read_output ecr_backend_api_repo_url)"
cluster="$(read_output ecs_cluster_name)"
service="$(read_output backend_service_name)"
region="$(read_output aws_region)"

registry="${repo_url%%/*}"
if [[ "${SKIP_ECR_LOGIN:-0}" != "1" ]]; then
  ecr_login "${region}" "${registry}"
fi

# Merge secrets.yml + prod.secrets.yml into backend/config/prod.secrets.yml
merged_secrets="${backend_dir}/config/prod.secrets.yml"
if [[ -f "${prod_secrets_file}" ]]; then
  echo "==> Merging secrets into ${merged_secrets} ..."
  merge_secrets_deep "${backend_dir}" "${default_secrets_file}" "${prod_secrets_file}" "${merged_secrets}"
  cleanup() {
    rm -f "${merged_secrets}"
    rm -f "${backend_dir}/config/prod.youtube-cookies.txt"
  }
  trap cleanup EXIT
fi

for candidate in "${project_dir}/prod.youtube-cookies.txt" "${project_dir}/youtube-cookies.txt"; do
  if [[ -f "${candidate}" ]]; then
    echo "==> Copying YouTube cookies companion file into backend/config ..."
    cp "${candidate}" "${backend_dir}/config/prod.youtube-cookies.txt"
    break
  fi
done

deploy_ecs_container_image "backend" "${backend_dir}" "${repo_url}" "${cluster}" "${service}" "${region}"

git_tag "backend_prod"

echo "Endpoint: https://api.smart-guitar.com"
