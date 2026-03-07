#!/usr/bin/env bash
set -euo pipefail

# Deploy ALL application components (excluding Terraform/infra).
# Includes:
#  - backend (ECS)
#  - demucs/chords/lyrics (Lambda)
#  - worker lambdas (job-orchestrator, vocals-guitar-stitch, stale-job-sweeper, unconfirmed-user-cleanup)
#  - frontend (S3/CloudFront)

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${script_dir}/_lib.sh"

require_infra_outputs
load_aws_env_from_secrets_if_missing

region="$(read_output aws_region)"

# Single ECR login shared by all deploy scripts.
registry="$(read_output ecr_backend_api_repo_url | cut -d/ -f1)"
ecr_login "${region}" "${registry}"

export SKIP_ECR_LOGIN=1

# Temporary directory for per-job exit codes.
status_dir="$(mktemp -d)"
trap 'rm -rf "${status_dir}"' EXIT

run_bg() {
  local name="$1"
  shift
  # Run the deploy script, prefix every line with [name], stream live.
  # Write exit code to a file so we can collect results later.
  # Subshell disables errexit so the status file is always written,
  # even when the deploy script fails.
  (
    set +e
    bash "$@" 2>&1 | sed -u "s/^/[${name}] /"
    echo "${PIPESTATUS[0]}" > "${status_dir}/${name}"
  ) &
}

run_bg backend  "${project_dir}/scripts/deploy/backend.sh"
run_bg demucs   "${project_dir}/scripts/deploy/demucs.sh"
run_bg chords   "${project_dir}/scripts/deploy/chords.sh"
run_bg lyrics   "${project_dir}/scripts/deploy/lyrics.sh"

run_bg job-orch "${project_dir}/scripts/deploy/job_orchestrator.sh"
run_bg stitch   "${project_dir}/scripts/deploy/vocals_guitar_stitch.sh"
run_bg sweeper  "${project_dir}/scripts/deploy/stale_job_sweeper.sh"
run_bg cleanup  "${project_dir}/scripts/deploy/unconfirmed_user_cleanup.sh"
run_bg frontend "${project_dir}/scripts/deploy/client.sh"

# Wait for all background jobs to finish (output streams live above).
wait

# Collect results.
echo ""
echo "==> Deploy results:"
failed=0
for f in "${status_dir}"/*; do
  name="$(basename "${f}")"
  code="$(cat "${f}")"
  if [[ "${code}" == "0" ]]; then
    echo "  ✓ ${name}"
  else
    echo "  ✗ ${name} FAILED (exit ${code})" >&2
    failed=1
  fi
done

if [[ "${failed}" == "0" ]]; then
  git_tag "deploy_all"
  echo "==> All components deployed (infra NOT included)."
else
  echo "==> Some components failed." >&2
  exit 1
fi
