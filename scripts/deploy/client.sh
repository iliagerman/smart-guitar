#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

frontend_dir="${project_dir}/frontend"

bucket="$(read_output frontend_bucket_name)"
cf_dist="$(read_output cloudfront_distribution_id)"

echo "==> Building frontend..."
cd "${frontend_dir}" && npm run build

echo "==> Syncing to s3://${bucket} ..."
aws s3 sync "${frontend_dir}/dist" "s3://${bucket}" --delete

echo "==> Invalidating CloudFront distribution ${cf_dist} ..."
aws cloudfront create-invalidation --distribution-id "${cf_dist}" --paths "/*" > /dev/null

git_tag "frontend"
