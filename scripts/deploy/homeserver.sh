#!/usr/bin/env bash
set -euo pipefail

# Deploy the YouTube downloader service to the homeserver.
# Transfers the build context, builds on the homeserver, and restarts the service.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/_lib.sh"

require_infra_outputs

homeserver_dir="${project_dir}/homeserver"
image_name="youtube-downloader"
image_tag="latest"
remote_host="homeserver"

# 1. Merge secrets (secrets.yml + prod.secrets.yml) into a temp file
merged_secrets="${homeserver_dir}/.secrets.yml"
prepare_secrets "${project_dir}/backend" "${merged_secrets}"

# 2. Read SQS queue URL from infra outputs
sqs_queue_url="$(read_output youtube_download_queue_url)"

# 3. Transfer only source files; avoid uploading the full image over Tailscale.
echo "==> Building ${image_name} image on ${remote_host}..."
tar -C "${homeserver_dir}" -czf - Dockerfile youtube_downloader.py \
  | ssh "${remote_host}" "docker build --platform linux/amd64 -t ${image_name}:${image_tag} -"

# 5. Stop existing container (if running)
echo "==> Stopping existing container..."
ssh "${remote_host}" "docker stop ${image_name} 2>/dev/null || true && docker rm ${image_name} 2>/dev/null || true"

# 6. Transfer merged secrets
echo "==> Transferring secrets..."
remote_dir=".config/${image_name}"
ssh "${remote_host}" "mkdir -p ~/${remote_dir}"
scp "${merged_secrets}" "${remote_host}:~/${remote_dir}/secrets.yml"

# 7. Start the container (resolve absolute path on remote for docker -v)
echo "==> Starting container..."
ssh "${remote_host}" "docker run -d \
  --name ${image_name} \
  --restart unless-stopped \
  -v \"\$(realpath ~/${remote_dir}/secrets.yml)\":/app/config/secrets.yml:ro \
  -e SQS_QUEUE_URL='${sqs_queue_url}' \
  ${image_name}:${image_tag}"

echo "==> Done. Container running on ${remote_host}."
echo "    View logs: ssh ${remote_host} docker logs -f ${image_name}"
