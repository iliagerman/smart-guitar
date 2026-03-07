#!/usr/bin/env bash
set -euo pipefail

# Shared helpers for deploy scripts.
# These scripts are invoked from the root `justfile`.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/../.." && pwd)"

outputs_file="${project_dir}/infra-outputs.json"
default_secrets_file="${project_dir}/secrets.yml"
prod_secrets_file="${project_dir}/prod.secrets.yml"
local_secrets_file="${project_dir}/local.secrets.yml"
test_secrets_file="${project_dir}/test.secrets.yml"

# Allow deploy scripts to explicitly choose a secrets file.
# If not set, helpers below will auto-detect a suitable file.
secrets_file_override="${SECRETS_FILE:-}"

require_file() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Required file not found: $f" >&2
    exit 1
  fi
}

require_infra_outputs() {
  require_file "${outputs_file}"
}

read_output() {
  local key="$1"
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d[sys.argv[2]]['value'])" \
    "${outputs_file}" "$key"
}

yaml_get_root_key() {
  # Extremely small YAML helper: reads a single scalar value.
  # Matches keys at any indentation level (root or nested).
  # Works for lines like: key: value  OR  key: "value"  OR  "  key: value"
  local file="$1"
  local key="$2"

  require_file "$file"

  local line
  line="$(grep -E "^[[:space:]]*${key}:" "$file" | head -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""  # caller decides if this is fatal
    return 0
  fi

  echo "$line" | sed -E "s/^[[:space:]]*${key}:[[:space:]]*//" | tr -d '"'
}

select_secrets_file_with_keys() {
  # Select the first secrets file that exists and contains all required keys.
  # Args: key1 key2 ...
  local required_keys=("$@")
  local candidates=()

  if [[ -n "${secrets_file_override}" ]]; then
    candidates+=("${secrets_file_override}")
  fi

  # Prefer explicit local/prod secrets if present; fall back to default.
  candidates+=(
    "${local_secrets_file}"
    "${prod_secrets_file}"
    "${default_secrets_file}"
    "${test_secrets_file}"
  )

  local f
  for f in "${candidates[@]}"; do
    if [[ -z "${f}" || ! -f "${f}" ]]; then
      continue
    fi

    local ok=1
    local k
    for k in "${required_keys[@]}"; do
      local v
      v="$(yaml_get_root_key "${f}" "${k}")"
      if [[ -z "${v}" ]]; then
        ok=0
        break
      fi
    done

    if [[ "${ok}" -eq 1 ]]; then
      echo "${f}"
      return 0
    fi
  done

  return 1
}

load_aws_env_from_secrets_if_missing() {
  # Prefer already-exported AWS_* env vars (AWS_PROFILE, SSO, etc).
  if [[ -n "${AWS_ACCESS_KEY_ID:-}" || -n "${AWS_PROFILE:-}" ]]; then
    export AWS_PAGER="${AWS_PAGER:-}"
    return 0
  fi

  local selected
  if ! selected="$(select_secrets_file_with_keys access_key secret_key region)"; then
    echo "ERROR: Missing AWS credentials. Provide AWS env vars (AWS_PROFILE or AWS_ACCESS_KEY_ID/SECRET/REGION)" >&2
    echo "       or set SECRETS_FILE to a YAML file containing: access_key, secret_key, region." >&2
    echo "       Checked (in order): ${local_secrets_file}, ${prod_secrets_file}, ${default_secrets_file}, ${test_secrets_file}" >&2
    exit 1
  fi

  export AWS_ACCESS_KEY_ID
  export AWS_SECRET_ACCESS_KEY
  export AWS_DEFAULT_REGION

  AWS_ACCESS_KEY_ID="$(yaml_get_root_key "${selected}" access_key)"
  AWS_SECRET_ACCESS_KEY="$(yaml_get_root_key "${selected}" secret_key)"
  AWS_DEFAULT_REGION="$(yaml_get_root_key "${selected}" region)"

  # (Sanity check; selection already ensured these are set.)
  if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" || -z "$AWS_DEFAULT_REGION" ]]; then
    echo "ERROR: Selected secrets file is missing access_key/secret_key/region: ${selected}" >&2
    exit 1
  fi

  export AWS_PAGER="${AWS_PAGER:-}"
}

load_tf_google_vars_from_secrets() {
  local selected
  if ! selected="$(select_secrets_file_with_keys google_client_id google_client_secret)"; then
    echo "ERROR: Missing Google OAuth vars. Set SECRETS_FILE or provide a YAML file containing: google_client_id, google_client_secret." >&2
    echo "       Checked (in order): ${local_secrets_file}, ${prod_secrets_file}, ${default_secrets_file}, ${test_secrets_file}" >&2
    exit 1
  fi

  export TF_VAR_google_client_id
  export TF_VAR_google_client_secret

  TF_VAR_google_client_id="$(yaml_get_root_key "${selected}" google_client_id)"
  TF_VAR_google_client_secret="$(yaml_get_root_key "${selected}" google_client_secret)"

  # (Sanity check; selection already ensured these are set.)
  if [[ -z "$TF_VAR_google_client_id" || -z "$TF_VAR_google_client_secret" ]]; then
    echo "ERROR: Selected secrets file is missing google_client_id/google_client_secret: ${selected}" >&2
    exit 1
  fi
}

ecr_login() {
  local region="$1"
  local registry="$2"

  echo "==> ECR login (${registry}) ..."
  aws ecr get-login-password --region "${region}" \
    | docker login --username AWS --password-stdin "${registry}"
}

deploy_lambda_container_image() {
  # Args:
  #   name, build_context_dir, repo_url, function_name, region
  # Optional env:
  #   DOCKERFILE, DOCKER_BUILD_ARGS (string)
  local name="$1"
  local dir="$2"
  local repo_url="$3"
  local function_name="$4"
  local region="$5"

  local image_uri="${repo_url}:latest"

  echo "==> [${name}] Building Docker image..."
  if [[ -n "${DOCKERFILE:-}" ]]; then
    # shellcheck disable=SC2086
    docker build --platform linux/amd64 -f "${DOCKERFILE}" ${DOCKER_BUILD_ARGS:-} -t "${image_uri}" "${dir}"
  else
    # shellcheck disable=SC2086
    docker build --platform linux/amd64 ${DOCKER_BUILD_ARGS:-} -t "${image_uri}" "${dir}"
  fi

  echo "==> [${name}] Pushing image..."
  docker push "${image_uri}"

  # Remove provisioned concurrency before updating (can't change alias version
  # while PC is allocated).  Silently ignored if none is configured.
  local had_pc=0
  if aws lambda get-provisioned-concurrency-config \
       --function-name "${function_name}" --qualifier live \
       --region "${region}" >/dev/null 2>&1; then
    had_pc=1
    echo "==> [${name}] Removing provisioned concurrency..."
    aws lambda delete-provisioned-concurrency-config \
      --function-name "${function_name}" --qualifier live \
      --region "${region}"
  fi

  echo "==> [${name}] Updating Lambda function code..."
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --image-uri "${image_uri}" \
    --region "${region}" \
    --output text --query 'FunctionArn'

  echo "==> [${name}] Waiting for update..."
  aws lambda wait function-updated \
    --function-name "${function_name}" \
    --region "${region}"

  echo "==> [${name}] Publishing version..."
  local version
  version="$(aws lambda publish-version \
    --function-name "${function_name}" \
    --region "${region}" \
    --query 'Version' --output text)"

  echo "==> [${name}] Updating alias 'live' -> ${version} ..."
  aws lambda update-alias \
    --function-name "${function_name}" \
    --name live \
    --function-version "${version}" \
    --routing-config 'AdditionalVersionWeights={}' \
    --region "${region}" \
    --output text --query 'AliasArn'

  # Re-add provisioned concurrency if it was present before.
  if [[ "${had_pc}" == "1" ]]; then
    echo "==> [${name}] Restoring provisioned concurrency..."
    aws lambda put-provisioned-concurrency-config \
      --function-name "${function_name}" --qualifier live \
      --provisioned-concurrent-executions 1 \
      --region "${region}" >/dev/null
  fi

  echo "==> [${name}] Done (version ${version})."
}

deploy_ecs_container_image() {
  # Args:
  #   name, build_context_dir, repo_url, cluster_name, service_name, region
  local name="$1"
  local dir="$2"
  local repo_url="$3"
  local cluster="$4"
  local service="$5"
  local region="$6"

  local image_uri="${repo_url}:latest"

  echo "==> [${name}] Building Docker image..."
  docker build --platform linux/amd64 -t "${image_uri}" "${dir}"

  echo "==> [${name}] Pushing image..."
  docker push "${image_uri}"

  echo "==> [${name}] Forcing new ECS deployment..."
  aws ecs update-service \
    --cluster "${cluster}" \
    --service "${service}" \
    --force-new-deployment \
    --region "${region}" \
    --output text --query 'service.serviceName'

  echo "==> [${name}] Waiting for service to stabilize..."
  aws ecs wait services-stable \
    --cluster "${cluster}" \
    --services "${service}" \
    --region "${region}"

  echo "==> [${name}] Done."
}

merge_secrets_deep() {
  # Deep-merge two YAML files and write to output file.
  # Uses `uv run` within the specified directory so PyYAML is available.
  local uv_dir="$1"
  local base="$2"
  local overlay="$3"
  local out="$4"

  uv run --directory "${uv_dir}" python3 -c "
import yaml, sys
base = yaml.safe_load(open(sys.argv[1])) or {}
overlay = yaml.safe_load(open(sys.argv[2])) or {}

def deep_merge(b, o):
    m = b.copy()
    for k, v in o.items():
        if k in m and isinstance(m[k], dict) and isinstance(v, dict):
            m[k] = deep_merge(m[k], v)
        else:
            m[k] = v
    return m

merged = deep_merge(base, overlay)
yaml.dump(merged, open(sys.argv[3], 'w'), default_flow_style=False)
" "${base}" "${overlay}" "${out}"
}

# Track files created by prepare_secrets so we can clean them all up on EXIT.
_merged_secrets_to_clean=()

_cleanup_merged_secrets() {
  for f in "${_merged_secrets_to_clean[@]}"; do
    rm -f "$f"
  done
}

prepare_secrets() {
  # Deep-merge secrets.yml + prod.secrets.yml into a target file and register
  # automatic cleanup on EXIT.  Safe to call multiple times (for different
  # output paths); all created files are removed when the script exits.
  #
  # Args:
  #   uv_dir   — directory where `uv run` can find PyYAML (e.g. backend_dir)
  #   output   — destination path for the merged YAML
  local uv_dir="$1"
  local output="$2"

  [[ -f "${prod_secrets_file}" ]] || return 0

  echo "==> Merging secrets into ${output} ..."
  merge_secrets_deep "${uv_dir}" "${default_secrets_file}" "${prod_secrets_file}" "${output}"

  _merged_secrets_to_clean+=("${output}")
  trap '_cleanup_merged_secrets' EXIT
}

refresh_worker_lambdas() {
  # Force existing Lambda functions to pull the latest ECR image.
  # Deploy scripts own code/version/alias; Terraform owns infra config
  # (memory, timeout, VPC, etc.) via lifecycle ignore_changes.
  # Silently skips functions that don't exist yet (first deploy).
  require_infra_outputs

  local region
  region="$(read_output aws_region)"

  local workers=("job_orchestrator" "vocals_guitar_stitch" "stale_job_sweeper" "unconfirmed_user_cleanup")

  for worker in "${workers[@]}"; do
    local repo_url function_name image_uri version had_pc

    repo_url="$(read_output "ecr_${worker}_repo_url" 2>/dev/null)" || continue
    function_name="$(read_output "${worker}_function_name" 2>/dev/null)" || continue

    # Skip if the function hasn't been created yet.
    if ! aws lambda get-function --function-name "${function_name}" --region "${region}" >/dev/null 2>&1; then
      echo "  [${worker}] Lambda not yet created, skipping."
      continue
    fi

    image_uri="${repo_url}:latest"

    # Remove provisioned concurrency before updating (can't change alias
    # version while PC is allocated).
    had_pc=0
    if aws lambda get-provisioned-concurrency-config \
         --function-name "${function_name}" --qualifier live \
         --region "${region}" >/dev/null 2>&1; then
      had_pc=1
      echo "  [${worker}] Removing provisioned concurrency..."
      aws lambda delete-provisioned-concurrency-config \
        --function-name "${function_name}" --qualifier live \
        --region "${region}"
    fi

    echo "  [${worker}] Updating code..."
    aws lambda update-function-code \
      --function-name "${function_name}" \
      --image-uri "${image_uri}" \
      --region "${region}" \
      --output text --query 'FunctionArn' >/dev/null

    echo "  [${worker}] Waiting for update..."
    aws lambda wait function-updated \
      --function-name "${function_name}" \
      --region "${region}"

    echo "  [${worker}] Publishing version..."
    version="$(aws lambda publish-version \
      --function-name "${function_name}" \
      --region "${region}" \
      --query 'Version' --output text)"

    echo "  [${worker}] Updating alias 'live' -> v${version}"
    aws lambda update-alias \
      --function-name "${function_name}" \
      --name live \
      --function-version "${version}" \
      --routing-config 'AdditionalVersionWeights={}' \
      --region "${region}" \
      --output text --query 'AliasArn' >/dev/null

    # Re-add provisioned concurrency if it was present before.
    if [[ "${had_pc}" == "1" ]]; then
      echo "  [${worker}] Restoring provisioned concurrency..."
      aws lambda put-provisioned-concurrency-config \
        --function-name "${function_name}" --qualifier live \
        --provisioned-concurrent-executions 1 \
        --region "${region}" >/dev/null
    fi

    echo "  [${worker}] Done."
  done
}

git_tag() {
  local prefix="$1"
  local tag="${prefix}_$(date +%Y%m%d_%H%M%S)"
  echo "==> Creating git tag: ${tag}"
  git tag "${tag}"
  echo "Tag: ${tag}"
}
