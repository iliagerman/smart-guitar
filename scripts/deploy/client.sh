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
# Fingerprinted assets never change under a given name, so cache them forever.
# index.html and sw.js bootstrap every load and MUST revalidate — without
# no-cache the browser serves a stale shell and the PWA never updates (which is
# exactly what made deploys invisible on device). Two passes: immutable for
# everything, then override the two bootstrap files with no-cache. Use `cp`
# (not a second sync) for the overrides because `s3 sync` compares size/mtime,
# not metadata, and would skip re-uploading an unchanged-size file.
aws s3 sync "${frontend_dir}/dist" "s3://${bucket}" --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" --exclude "sw.js"
aws s3 cp "${frontend_dir}/dist/index.html" "s3://${bucket}/index.html" \
  --cache-control "no-cache" --content-type "text/html"
aws s3 cp "${frontend_dir}/dist/sw.js" "s3://${bucket}/sw.js" \
  --cache-control "no-cache" --content-type "text/javascript"

echo "==> Invalidating CloudFront distribution ${cf_dist} ..."
aws cloudfront create-invalidation --distribution-id "${cf_dist}" --paths "/*" > /dev/null

git_tag "frontend"
