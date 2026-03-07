#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

bucket="$(read_output landing_bucket_name)"
cf_dist="$(read_output landing_cloudfront_distribution_id)"

echo "==> Syncing homepage to s3://${bucket} ..."
aws s3 sync "${project_dir}/homepage" "s3://${bucket}" --delete \
  --exclude ".DS_Store" --exclude "plan.md"

echo "==> Invalidating CloudFront distribution ${cf_dist} ..."
aws cloudfront create-invalidation --distribution-id "${cf_dist}" --paths "/*" > /dev/null

git_tag "homepage"
