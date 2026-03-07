# Guitar Player - Project Commands

set dotenv-load := false
set shell := ["bash", "-euo", "pipefail", "-c"]

export VIRTUAL_ENV := ""

project_dir := justfile_directory()
infra_dir := project_dir + "/infra"
default_audio := project_dir + "/local_bucket/bob_dylan/knocking_on_heavens_door/Bob Dylan - Knockin' On Heaven's Door (Official Audio).mp3"
default_vocals := project_dir + "/local_bucket_test/bob_dylan_vocals/knocking_on_heavens_door/vocals.mp3"
default_vocals_key := "bob_dylan_vocals/knocking_on_heavens_door/vocals.mp3"

# ── Infrastructure ──────────────────────────────────────────────

# Deploy all AWS infrastructure and write infra-outputs.json.
# Handles first deploy and subsequent updates:
#  1) ensures ECR repos exist
#  2) builds & pushes worker images
#  3) refreshes existing Lambdas (Terraform can't detect ECR digest changes)
#  4) runs full terraform apply
deploy-infra:
    bash "{{project_dir}}/scripts/deploy/infra.sh" apply


# Push worker Lambda images to ECR (no Lambda update/version publish).
# Use this before the first Terraform apply that creates the functions.
push-job-orchestrator-image:
    bash "{{project_dir}}/scripts/deploy/push_job_orchestrator_image.sh"


push-vocals-guitar-stitch-image:
    bash "{{project_dir}}/scripts/deploy/push_vocals_guitar_stitch_image.sh"


push-stale-job-sweeper-image:
    bash "{{project_dir}}/scripts/deploy/push_stale_job_sweeper_image.sh"


push-unconfirmed-user-cleanup-image:
    bash "{{project_dir}}/scripts/deploy/push_unconfirmed_user_cleanup_image.sh"

# Deploy YouTube downloader to homeserver (build container, transfer, start)
deploy-homeserver:
    bash "{{project_dir}}/scripts/deploy/homeserver.sh"

# Destroy all AWS infrastructure
destroy-infra:
    bash "{{project_dir}}/scripts/deploy/infra.sh" destroy

# Validate Terraform configuration (quick sanity check)
tf-validate:
    bash "{{project_dir}}/scripts/deploy/infra.sh" validate

# Check CloudWatch log groups for backend + worker Lambdas (helps debug Grafana CloudWatch dashboards)
cw-check-worker-logs:
    #!/usr/bin/env bash
    set -euo pipefail

    PROJECT_DIR="{{project_dir}}"
    OUTPUTS_FILE="${PROJECT_DIR}/infra-outputs.json"

    if [[ ! -f "$OUTPUTS_FILE" ]]; then
        echo "ERROR: ${OUTPUTS_FILE} not found. Run 'just deploy-infra' first (or generate outputs)." >&2
        exit 1
    fi

    # Prefer AWS_PROFILE (e.g. AWS_PROFILE=smart-guitar) when available.
    # Fallback to static credentials from secrets.yml for backwards compatibility.
    if [[ -n "${AWS_PROFILE:-}" ]]; then
        export AWS_PAGER=""
    else
        AWS_ACCESS_KEY_ID=$(grep 'access_key:' "${PROJECT_DIR}/secrets.yml" | awk '{print $2}')
        AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "${PROJECT_DIR}/secrets.yml" | awk '{print $2}')
        AWS_DEFAULT_REGION=$(grep 'region:' "${PROJECT_DIR}/secrets.yml" | awk '{print $2}')
        export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION AWS_PAGER=""
    fi

    read_output() {
        python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d[sys.argv[2]]['value'])" \
            "$OUTPUTS_FILE" "$1"
    }

    PROJECT_NAME=$(read_output "project_name")
    REGION=$(read_output "aws_region")

    start_ms=$(python3 -c 'import time; print(int((time.time()-3600)*1000))')

    groups=(
        "/ecs/${PROJECT_NAME}-backend-api"
        "/aws/lambda/${PROJECT_NAME}-job-orchestrator"
        "/aws/lambda/${PROJECT_NAME}-vocals-guitar-stitch"
        "/aws/lambda/${PROJECT_NAME}-stale-job-sweeper"
        "/aws/lambda/${PROJECT_NAME}-unconfirmed-user-cleanup"
    )

    echo "Region: ${REGION}"
    echo "Project: ${PROJECT_NAME}"
    echo ""

    for g in "${groups[@]}"; do
        echo "== ${g} =="
        if ! aws logs describe-log-groups --region "${REGION}" --log-group-name-prefix "${g}" --query 'logGroups[0].logGroupName' --output text | grep -q "${g}"; then
            echo "  (missing)"
            echo ""
            continue
        fi

        aws logs filter-log-events \
            --region "${REGION}" \
            --log-group-name "${g}" \
            --start-time "${start_ms}" \
            --limit 5 \
            --query 'events[*].message' \
            --output text \
            | sed 's/^/  /'
        echo ""
    done

# ── Deployments ───────────────────────────────────────────────

# Build, push, and deploy the lyrics_generator Lambda function
deploy-lyrics whisper_model="medium":
    WHISPER_MODEL="{{whisper_model}}" bash "{{project_dir}}/scripts/deploy/lyrics.sh"

# Build, push, and deploy the chords_generator Lambda function
deploy-chords:
    bash "{{project_dir}}/scripts/deploy/chords.sh"

# Build, push, and deploy the backend-api ECS service
deploy-backend:
    bash "{{project_dir}}/scripts/deploy/backend.sh"

# Build, push, and deploy the inference_demucs Lambda function
deploy-demucs:
    bash "{{project_dir}}/scripts/deploy/demucs.sh"

# Build, push, and deploy the job orchestrator Lambda function
deploy-job-orchestrator:
    bash "{{project_dir}}/scripts/deploy/job_orchestrator.sh"

# Build, push, and deploy the vocals+guitar stitch Lambda function
deploy-vocals-guitar-stitch:
    bash "{{project_dir}}/scripts/deploy/vocals_guitar_stitch.sh"

# Build, push, and deploy the stale job sweeper Lambda function
deploy-stale-job-sweeper:
    bash "{{project_dir}}/scripts/deploy/stale_job_sweeper.sh"

# Build, push, and deploy the unconfirmed user cleanup Lambda function
deploy-unconfirmed-user-cleanup:
    bash "{{project_dir}}/scripts/deploy/unconfirmed_user_cleanup.sh"

# ── Inference Demucs ────────────────────────────────────────────

# Install all demucs dependencies
setup-demucs:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/inference_demucs"
    uv lock
    uv sync --python 3.11

# Start the demucs API server
run-demucs:
    cd {{project_dir}}/inference_demucs && APP_ENV=dev uv run uvicorn inference_demucs.api:app --reload --host 0.0.0.0 --port 8000

# Run all demucs tests with cleanup (removes stem output after tests)
test-demucs audio_file=default_audio cleanup='true':
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/inference_demucs"
    SONG_DIR="$(dirname "{{audio_file}}")"
    echo "Starting API server..."
    APP_ENV=dev uv run uvicorn inference_demucs.api:app --host 0.0.0.0 --port 8000 &
    SERVER_PID=$!
    if [[ "{{cleanup}}" == "true" ]]; then
        trap "kill $SERVER_PID 2>/dev/null || true; rm -f \"$SONG_DIR\"/{vocals,drums,bass,guitar,piano,other,guitar_removed,vocals_removed}.mp3" EXIT
    else
        trap "kill $SERVER_PID 2>/dev/null || true" EXIT
    fi
    for i in $(seq 1 30); do
        if curl -s http://localhost:8000/health > /dev/null 2>&1; then break; fi
        sleep 1
    done
    echo "Server ready. Sending separation request..."
    curl -s -X POST http://localhost:8000/separate \
        -H 'Content-Type: application/json' \
        -d "{\"input_path\": \"{{audio_file}}\"}" | python -m json.tool
    echo ""
    if [[ "{{cleanup}}" == "true" ]]; then
        echo "Done. Stopping server and cleaning stem output."
    else
        echo "Done. Stopping server (keeping outputs)."
    fi

# ── Chords Generator ──────────────────────────────────────────

# Install chords generator dependencies
# Pre-installs numpy+setuptools because vamp needs them at build time (no-build-isolation)
# Sets CPLUS_INCLUDE_PATH so vamp's C++ extension finds <string> header on macOS
# Sets ARCHFLAGS to ensure native arm64 compilation on Apple Silicon
# Copies nnls-chroma VAMP plugin to user plugin directory for autochord
# Requires: brew install vamp-plugin-sdk
setup-chords:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/chords_generator"
    uv venv --python 3.11
    uv pip install numpy setuptools
    export CPLUS_INCLUDE_PATH="$(xcrun --show-sdk-path)/usr/include/c++/v1"
    export ARCHFLAGS="-arch arm64"
    uv sync
    # Copy nnls-chroma VAMP plugin for autochord (bundled .so is Linux-only;
    # on macOS we rely on the brew vamp-plugin-sdk build or a native .dylib).
    mkdir -p "$HOME/Library/Audio/Plug-Ins/Vamp"

# Start the chords generator API server
run-chords:
    cd {{project_dir}}/chords_generator && TF_USE_LEGACY_KERAS=1 APP_ENV=local uv run uvicorn chords_generator.api:app --reload --host 0.0.0.0 --port 8001

# Run all chords tests with cleanup (removes chord output after tests)
test-chords audio_file=default_audio cleanup='true':
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/chords_generator"
    SONG_DIR="$(dirname "{{audio_file}}")"
    echo "Starting API server..."
    TF_USE_LEGACY_KERAS=1 APP_ENV=local uv run uvicorn chords_generator.api:app --host 0.0.0.0 --port 8001 &
    SERVER_PID=$!
    if [[ "{{cleanup}}" == "true" ]]; then
        trap "kill $SERVER_PID 2>/dev/null || true; rm -f \"$SONG_DIR/chords.json\" \"$SONG_DIR/chords.lab\" \"$SONG_DIR\"/chords_*.json" EXIT
    else
        trap "kill $SERVER_PID 2>/dev/null || true" EXIT
    fi
    for i in $(seq 1 30); do
        if curl -s http://localhost:8001/health > /dev/null 2>&1; then break; fi
        sleep 1
    done
    echo "Server ready. Sending chord recognition request..."
    RESPONSE=$(curl -s -X POST http://localhost:8001/recognize \
        -H 'Content-Type: application/json' \
        -d "{\"input_path\": \"{{audio_file}}\"}")
    echo "$RESPONSE" | python -m json.tool
    echo ""

    # ── Verify original chord outputs ──
    echo "Verifying original chord outputs..."
    if [ ! -f "$SONG_DIR/chords.json" ]; then
        echo "FAIL: chords.json not found in $SONG_DIR" && exit 1
    fi
    if [ ! -f "$SONG_DIR/chords.lab" ]; then
        echo "FAIL: chords.lab not found in $SONG_DIR" && exit 1
    fi
    echo "OK: chords.json and chords.lab exist"

    # ── Verify simplified chord files ──
    echo "Verifying simplified chord files..."
    python3 "{{project_dir}}/chords_generator/scripts/verify_simplified_chords.py" "$SONG_DIR"
    echo ""
    if [[ "{{cleanup}}" == "true" ]]; then
        echo "Done. Stopping server and cleaning output."
    else
        echo "Done. Stopping server (keeping outputs)."
    fi

# ── Lyrics Generator ──────────────────────────────────────────

# Install lyrics generator dependencies
setup-lyrics:
    # Include dev deps because we have a pytest suite under lyrics_generator/tests.
    cd {{project_dir}}/lyrics_generator && uv sync --python 3.11 --extra dev

# Start the lyrics generator API server
run-lyrics:
    cd {{project_dir}}/lyrics_generator && APP_ENV=local uv run uvicorn lyrics_generator.api:app --reload --host 0.0.0.0 --port 8003

# Run lyrics transcription test with cleanup (removes lyrics.json after test)
test-lyrics vocals_file=default_vocals vocals_key=default_vocals_key cleanup='true':
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/lyrics_generator"
    SONG_DIR="$(dirname "{{vocals_file}}")"
    echo "Starting API server..."
    # Use APP_ENV=test so storage.base_path points at ../local_bucket_test.
    APP_ENV=test uv run uvicorn lyrics_generator.api:app --host 0.0.0.0 --port 8003 &
    SERVER_PID=$!
    if [[ "{{cleanup}}" == "true" ]]; then
        trap "kill $SERVER_PID 2>/dev/null || true; rm -f \"$SONG_DIR/lyrics.json\"" EXIT
    else
        trap "kill $SERVER_PID 2>/dev/null || true" EXIT
    fi
    for i in $(seq 1 60); do
        if curl -s http://localhost:8003/health > /dev/null 2>&1; then break; fi
        sleep 1
    done
    echo "Server ready. Sending transcription request..."
    curl -s -X POST http://localhost:8003/transcribe \
        -H 'Content-Type: application/json' \
        -d "{\"input_path\": \"{{vocals_key}}\"}" | python3 -m json.tool
    echo ""
    echo "Verifying lyrics output..."
    if [ ! -f "$SONG_DIR/lyrics.json" ]; then
        echo "FAIL: lyrics.json not found in $SONG_DIR" && exit 1
    fi
    echo "OK: lyrics.json exists"
    echo ""
    if [[ "{{cleanup}}" == "true" ]]; then
        echo "Done. Stopping server and cleaning output."
    else
        echo "Done. Stopping server (keeping outputs)."
    fi

# ── Backend ────────────────────────────────────────────────────

# Update backend uv.lock (required for Docker builds using --frozen)
lock-backend:
    cd {{project_dir}}/backend && uv lock

# Install backend dependencies
setup-backend:
    cd {{project_dir}}/backend && uv sync --extra dev

# Compile Python sources (syntax check) using uv (no system python required)
py-compile:
    uv run --directory {{project_dir}}/backend python -m compileall src/guitar_player -q
    uv run --directory {{project_dir}}/lyrics_generator python -m compileall src/lyrics_generator -q

# Start the backend API server
dev-backend:
    cd {{project_dir}}/backend && APP_ENV=local uv run uvicorn guitar_player.main:app --reload --host 0.0.0.0 --port 8002

# Generate a new Alembic migration (provide message as arg)
db-revision message:
    cd {{project_dir}}/backend && APP_ENV=local uv run alembic revision --autogenerate -m "{{message}}"

# Run all pending migrations (creates DB if it doesn't exist)
db-migrate:
    cd {{project_dir}}/backend && APP_ENV=local uv run alembic upgrade head

# Roll back the last migration
db-rollback:
    cd {{project_dir}}/backend && APP_ENV=local uv run alembic downgrade -1

# Run all backend tests with cleanup (removes downloaded outputs after tests)
test-backend cleanup='true':
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/backend"
    uv sync --extra dev
    if [[ "{{cleanup}}" == "true" ]]; then
        APP_ENV=test uv run pytest tests/ -v -s -k "not no_cleanup"
    else
        APP_ENV=test uv run pytest tests/ -v -s -k "not with_cleanup"
    fi

# Backfill legacy OGG media to MP3 CBR 192k (does not delete OGG).
# Accepts key=value args *after* the recipe name, e.g.:
#   just backfill-mp3-media dry_run=true limit=50 include_stems=false
# Use include_stems=true only if you have old `.ogg` stem files in local_bucket.
backfill-mp3-media *kv:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{project_dir}}/backend"

    dry_run="true"
    limit="0"
    include_stems="false"

    for pair in {{kv}}; do
        case "$pair" in
            dry_run=*) dry_run="${pair#dry_run=}" ;;
            limit=*) limit="${pair#limit=}" ;;
            include_stems=*) include_stems="${pair#include_stems=}" ;;
            *)
                echo "ERROR: unknown arg '$pair' (expected dry_run=..., limit=..., include_stems=...)" >&2
                exit 2
                ;;
        esac
    done

    args=()
    if [[ "$dry_run" == "true" ]]; then
        args+=("--dry-run")
    fi
    if [[ "$limit" != "0" ]]; then
        args+=("--limit" "$limit")
    fi
    if [[ "$include_stems" == "true" ]]; then
        args+=("--include-stems")
    fi

    APP_ENV=local uv run python scripts/backfill_mp3_media.py "${args[@]}"

# One-time conversion utility: convert ALL .ogg files in the local buckets to .mp3.
# By default this scans BOTH buckets:
#   - {{project_dir}}/local_bucket
#   - {{project_dir}}/local_bucket_test
#
# Example (dry-run):
#   just convert-ogg-to-mp3-buckets dry_run=true
#
# Example (real run + delete .ogg after success):
#   just convert-ogg-to-mp3-buckets dry_run=false delete_ogg=true
convert-ogg-to-mp3-buckets *kv:
    #!/usr/bin/env bash
    set -euo pipefail

    dry_run="true"
    delete_ogg="false"
    prune="true"
    limit="0"
    buckets="both"  # both|root|test
    progress_every="50"

    for pair in {{kv}}; do
        case "$pair" in
            dry_run=*) dry_run="${pair#dry_run=}" ;;
            delete_ogg=*) delete_ogg="${pair#delete_ogg=}" ;;
            prune=*) prune="${pair#prune=}" ;;
            limit=*) limit="${pair#limit=}" ;;
            buckets=*) buckets="${pair#buckets=}" ;;
            progress_every=*) progress_every="${pair#progress_every=}" ;;
            *)
                echo "ERROR: unknown arg '$pair' (expected dry_run=..., delete_ogg=..., prune=..., limit=..., progress_every=..., buckets=both|root|test)" >&2
                exit 2
                ;;
        esac
    done

    args=()
    if [[ "$dry_run" == "true" ]]; then
        args+=("--dry-run")
    fi
    if [[ "$delete_ogg" == "true" ]]; then
        args+=("--delete-ogg")
    fi
    if [[ "$limit" != "0" ]]; then
        args+=("--limit" "$limit")
    fi
    if [[ "$progress_every" != "0" ]]; then
        args+=("--progress-every" "$progress_every")
    else
        args+=("--progress-every" "0")
    fi
    if [[ "$prune" == "true" ]]; then
        args+=("--prune-non-media")
    fi

    cd "{{project_dir}}/backend"

    if [[ "$buckets" == "both" || "$buckets" == "root" ]]; then
        echo "== Converting root bucket: {{project_dir}}/local_bucket =="
        APP_ENV=local uv run python scripts/convert_ogg_to_mp3_bucket.py \
            --base-path "{{project_dir}}/local_bucket" \
            "${args[@]}"
        echo ""
    fi

    if [[ "$buckets" == "both" || "$buckets" == "test" ]]; then
        echo "== Converting test bucket: {{project_dir}}/local_bucket_test =="
        APP_ENV=local uv run python scripts/convert_ogg_to_mp3_bucket.py \
            --base-path "{{project_dir}}/local_bucket_test" \
            "${args[@]}"
    fi

# Build-only tests for worker Lambdas (verifies Docker builds locally)
test-job-orchestrator:
    cd {{project_dir}}/backend && docker build --platform linux/amd64 -f Dockerfile.job-orchestrator -t smart-guitar/job-orchestrator:test .

test-vocals-guitar-stitch:
    cd {{project_dir}}/backend && docker build --platform linux/amd64 -f Dockerfile.vocals-guitar-stitch -t smart-guitar/vocals-guitar-stitch:test .

test-stale-job-sweeper:
    cd {{project_dir}}/backend && docker build --platform linux/amd64 -f Dockerfile.stale-job-sweeper -t smart-guitar/stale-job-sweeper:test .

test-unconfirmed-user-cleanup:
    cd {{project_dir}}/backend && docker build --platform linux/amd64 -f Dockerfile.unconfirmed-user-cleanup -t smart-guitar/unconfirmed-user-cleanup:test .

# Run auth integration tests against real Cognito
test-auth:
    cd {{project_dir}}/backend && APP_ENV=local uv run pytest tests/test_auth.py -v -s

# Backfill genre for existing songs (calls LLM for each song without a genre)
backfill-genres:
    cd {{project_dir}}/backend && APP_ENV=local uv run python scripts/backfill_genres.py

# Cleanup local_bucket/ by removing original-audio files whose filenames suggest
# live concert/show recordings.
#
# Examples:
#   just cleanup-live-media "--mode contextual"  # dry-run
#   just cleanup-live-media "--mode contextual --delete --target file"  # delete mp3 only
#   just cleanup-live-media "--mode contextual --delete --target song_folder --db-delete"  # delete folder + DB
#   just cleanup-live-media "--mode strict --delete --target song_folder --db-delete"  # aggressive delete
cleanup-live-media args="--mode contextual":
    cd {{project_dir}}/backend && APP_ENV=local uv run python scripts/cleanup_live_media.py {{args}}

# Seed the DB with dummy songs across all genres (for UI testing)
seed-db:
    cd {{project_dir}}/backend && APP_ENV=local uv run python scripts/seed_db.py

# Export seed songs from backend code into a JSON file to keep seed_service.py clean.
# Writes: backend/src/guitar_player/services/seed_songs.json
export-seed-songs:
    cd {{project_dir}}/backend && APP_ENV=local uv run python scripts/export_seed_songs.py

# Run the admin heal runner: scan for songs with missing artifacts and heal them.
#
# Token handling:
# - If token is provided: uses it.
# - Otherwise: loads admin.api-key from secrets.yml.
#
# Example:
#   just admin-run "http://localhost:8002" "" "--batch-size 3"
#   just admin-run "http://localhost:8002" MY_TOKEN "--batch-size 3 --limit-total 10"
admin-run base_url="http://localhost:8002" token="" extra_args="":
    #!/usr/bin/env bash
    set -euo pipefail

    PROJECT_DIR="{{project_dir}}"
    token_value="{{token}}"

    if [[ -z "$token_value" ]]; then
        if [[ "{{base_url}}" == *"smart-guitar.com"* ]]; then
            secrets_file="${PROJECT_DIR}/prod.secrets.yml"
        else
            secrets_file="${PROJECT_DIR}/secrets.yml"
        fi

        if [[ -f "$secrets_file" ]]; then
            token_value="$(
                cd "${PROJECT_DIR}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
        fi

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in ${secrets_file}" >&2
            exit 1
        fi
    fi

    echo "==> Running admin heal against {{base_url}} ..."
    cd "${PROJECT_DIR}/backend" && uv run python scripts/admin_runner.py \
        --base-url "{{base_url}}" \
        --token "${token_value}" \
        {{extra_args}}

# Populate the predefined seed song list into the DB and sync local media to storage.
#
# When targeting production (base_url contains smart-guitar.com):
#   1. Syncs local_bucket/ to the S3 bucket (thumbnails, YouTube IDs, etc.)
#   2. Seeds the DB via the API (discovers the synced storage keys)
#
# Token handling:
# - If token is provided: uses it.
# - Otherwise: loads admin.api-key from secrets.yml.
#
# Example:
#   just admin-seed-populate
#   just admin-seed-populate-dry-run
#   just admin-seed-populate base_url="https://api.smart-guitar.com"
#   just admin-seed-populate token=YOUR_TOKEN
admin-seed-populate base_url="http://localhost:8002" token="":
    #!/usr/bin/env bash
    set -euo pipefail

    PROJECT_DIR="{{project_dir}}"
    token_value="{{token}}"

    if [[ -z "$token_value" ]]; then
        # Use prod secrets for production URLs, local secrets otherwise.
        if [[ "{{base_url}}" == *"smart-guitar.com"* ]]; then
            secrets_file="${PROJECT_DIR}/prod.secrets.yml"
        else
            secrets_file="${PROJECT_DIR}/secrets.yml"
        fi

        if [[ -f "$secrets_file" ]]; then
            token_value="$(
                cd "${PROJECT_DIR}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
        fi

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in ${secrets_file}" >&2
            exit 1
        fi
    fi

    # ── Sync local media files to S3 first when targeting production ──
    # This ensures thumbnails and YouTube IDs are in the bucket before the
    # DB seed discovers storage keys.
    if [[ "{{base_url}}" == *"smart-guitar.com"* ]]; then
        OUTPUTS_FILE="${PROJECT_DIR}/infra-outputs.json"
        if [[ ! -f "$OUTPUTS_FILE" ]]; then
            echo "ERROR: ${OUTPUTS_FILE} not found. Run 'just deploy-infra' first." >&2
            exit 1
        fi

        export AWS_ACCESS_KEY_ID=$(grep 'access_key:' "${PROJECT_DIR}/secrets.yml" | awk '{print $2}')
        export AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "${PROJECT_DIR}/secrets.yml" | awk '{print $2}')
        export AWS_DEFAULT_REGION=$(grep 'region:' "${PROJECT_DIR}/secrets.yml" | awk '{print $2}')
        export AWS_PAGER=""

        BUCKET=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d[sys.argv[2]]['value'])" \
            "$OUTPUTS_FILE" "audio_bucket_name")

        echo "==> Syncing local_bucket/ to s3://${BUCKET}/ ..."
        aws s3 sync "${PROJECT_DIR}/local_bucket" "s3://${BUCKET}" \
            --size-only \
            --exclude ".DS_Store"

        echo "==> S3 sync complete."
    fi

    echo "==> Seeding DB via {{base_url}} ..."
    curl -sS -N --max-time 1800 -X POST "{{base_url}}/api/v1/admin/seed/populate" \
            -H "Authorization: Bearer ${token_value}" \
        | python3 -u "${PROJECT_DIR}/scripts/ndjson_progress.py"

# Dry-run variant: reports what seed/populate would change without writing.
admin-seed-populate-dry-run base_url="http://localhost:8002" token="":
    #!/usr/bin/env bash
    set -euo pipefail

    PROJECT_DIR="{{project_dir}}"
    token_value="{{token}}"

    if [[ -z "$token_value" ]]; then
        if [[ "{{base_url}}" == *"smart-guitar.com"* ]]; then
            secrets_file="${PROJECT_DIR}/prod.secrets.yml"
        else
            secrets_file="${PROJECT_DIR}/secrets.yml"
        fi

        if [[ -f "$secrets_file" ]]; then
            token_value="$(
                cd "${PROJECT_DIR}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
        fi

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in ${secrets_file}" >&2
            exit 1
        fi
    fi

    echo "==> DRY RUN: Seeding DB via {{base_url}} (no changes will be written) ..."
    curl -sS -N -X POST "{{base_url}}/api/v1/admin/seed/populate?dry_run=true" \
            -H "Authorization: Bearer ${token_value}" \
        | python3 -u "${PROJECT_DIR}/scripts/ndjson_progress.py"

# Drop a single song by ID, including all storage files.
#
# Token handling:
# - If token is provided: uses it.
# - Otherwise: loads admin.api-key from prod.secrets.yml (preferred) or secrets.yml.
#
# Example:
#   just admin-drop-song song_id="<uuid>"
#   just admin-drop-song song_id="<uuid>" base_url="http://localhost:8002"
admin-drop-song song_id base_url="https://api.smart-guitar.com" token="":
    #!/usr/bin/env bash
    set -euo pipefail

    token_value="{{token}}"

    if [[ -z "$token_value" ]]; then
        for secrets_file in "{{project_dir}}/prod.secrets.yml" "{{project_dir}}/secrets.yml"; do
            [[ -f "$secrets_file" ]] || continue
            token_value="$(
                cd "{{project_dir}}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
            [[ -n "$token_value" ]] && break
        done

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in prod.secrets.yml or secrets.yml" >&2
            exit 1
        fi
    fi

    echo "==> Dropping song {{song_id}} via {{base_url}} ..."
    curl -sS -X DELETE "{{base_url}}/api/v1/admin/songs/{{song_id}}" \
        -H "Authorization: Bearer ${token_value}" | uv run --directory "{{project_dir}}/backend" python -m json.tool

# Drop ALL songs from the DB only (storage files are kept). DESTRUCTIVE!
#
# Example:
#   just admin-drop-all-songs-from-db
#   just admin-drop-all-songs-from-db "http://localhost:8002"
admin-drop-all-songs-from-db base_url="https://api.smart-guitar.com" token="":
    #!/usr/bin/env bash
    set -euo pipefail

    token_value="{{token}}"
    if [[ -z "$token_value" ]]; then
        for secrets_file in "{{project_dir}}/prod.secrets.yml" "{{project_dir}}/secrets.yml"; do
            [[ -f "$secrets_file" ]] || continue
            token_value="$(
                cd "{{project_dir}}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
            [[ -n "$token_value" ]] && break
        done

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in prod.secrets.yml or secrets.yml" >&2
            exit 1
        fi
    fi

    echo "WARNING: This will delete ALL songs from the DB (storage files will be KEPT)!"
    read -p "Type 'yes-delete-all' to confirm: " confirm
    if [[ "$confirm" != "yes-delete-all" ]]; then
        echo "Aborted."
        exit 1
    fi

    echo "==> Dropping all songs (DB only) via {{base_url}} ..."
    response="$(curl -sS -w '\n%{http_code}' -X DELETE "{{base_url}}/api/v1/admin/songs?confirm=yes-delete-all&skip_storage=true" \
        -H "Authorization: Bearer ${token_value}" \
        --max-time 300)"

# Drop ALL songs, including all storage files. DESTRUCTIVE!
#
# Example:
#   just admin-drop-all-songs
#   just admin-drop-all-songs "http://localhost:8002"
admin-drop-all-songs base_url="https://api.smart-guitar.com" token="":
    #!/usr/bin/env bash
    set -euo pipefail

    token_value="{{token}}"
    if [[ -z "$token_value" ]]; then
        for secrets_file in "{{project_dir}}/prod.secrets.yml" "{{project_dir}}/secrets.yml"; do
            [[ -f "$secrets_file" ]] || continue
            token_value="$(
                cd "{{project_dir}}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
            [[ -n "$token_value" ]] && break
        done

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in prod.secrets.yml or secrets.yml" >&2
            exit 1
        fi
    fi

    echo "WARNING: This will delete ALL songs and their storage files!"
    read -p "Type 'yes-delete-all' to confirm: " confirm
    if [[ "$confirm" != "yes-delete-all" ]]; then
        echo "Aborted."
        exit 1
    fi

    echo "==> Dropping all songs via {{base_url}} ..."
    response="$(curl -sS -w '\n%{http_code}' -X DELETE "{{base_url}}/api/v1/admin/songs?confirm=yes-delete-all" \
        -H "Authorization: Bearer ${token_value}" \
        --max-time 300)"
    http_code="$(echo "$response" | tail -n1)"
    body="$(echo "$response" | sed '$d')"

    if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
        echo "$body" | uv run --directory "{{project_dir}}/backend" python -m json.tool
    else
        echo "HTTP $http_code" >&2
        echo "$body" >&2
        exit 1
    fi

# Run the production sanity check (calls POST /api/v1/admin/sanity).
#
# Token handling:
# - If token is provided: uses it.
# - Otherwise: loads admin.api-key from prod.secrets.yml (preferred) or secrets.yml.
#
# Example:
#   just test-prod
#   just test-prod token=YOUR_TOKEN
#   just test-prod base_url=http://localhost:8002
test-prod base_url="https://api.smart-guitar.com" token="":
    #!/usr/bin/env bash
    set -euo pipefail

    token_value="{{token}}"

    if [[ -z "$token_value" ]]; then
        for secrets_file in "{{project_dir}}/prod.secrets.yml" "{{project_dir}}/secrets.yml"; do
            [[ -f "$secrets_file" ]] || continue
            token_value="$(
                cd "{{project_dir}}/backend" \
                    && APP_ENV=local uv run python -c 'import sys, yaml; from pathlib import Path; p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()) or {}; t=(d.get("admin") or {}).get("api-key"); print(t or "")' \
                    "$secrets_file"
            )"
            [[ -n "$token_value" ]] && break
        done

        if [[ -z "$token_value" ]]; then
            echo "admin.api-key not found in prod.secrets.yml or secrets.yml" >&2
            exit 1
        fi
    fi

    echo "Running sanity check against {{base_url}} ..."
    curl -sS -X POST "{{base_url}}/api/v1/admin/sanity" \
        -H "Authorization: Bearer ${token_value}" \
        -H "Content-Type: application/json" \
        --max-time 600 | python3 -m json.tool

# ── Logs ──────────────────────────────────────────────────────

# Stream live backend logs (Ctrl+C to stop)
logs-backend since="5m":
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "${AWS_PROFILE:-}" ]]; then
        export AWS_ACCESS_KEY_ID=$(grep 'access_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_DEFAULT_REGION=$(grep 'region:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    fi
    aws logs tail /ecs/smart-guitar-backend-api --follow --since "{{since}}" --format short \
        | grep --line-buffered -v "GET /health"

# Stream live demucs logs (Ctrl+C to stop)
logs-demucs since="5m":
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "${AWS_PROFILE:-}" ]]; then
        export AWS_ACCESS_KEY_ID=$(grep 'access_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_DEFAULT_REGION=$(grep 'region:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    fi
    aws logs tail /aws/lambda/smart-guitar-demucs --follow --since "{{since}}" --format short

# Stream live lyrics_generator Lambda logs (Ctrl+C to stop)
logs-lyrics since="5m":
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "${AWS_PROFILE:-}" ]]; then
        export AWS_ACCESS_KEY_ID=$(grep 'access_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_DEFAULT_REGION=$(grep 'region:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    fi
    aws logs tail /aws/lambda/smart-guitar-lyrics-generator --follow --since "{{since}}" --format short

# Query recent backend logs (finite output). Optional CloudWatch filter pattern.
cw-backend-recent minutes="60" filter="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "${AWS_PROFILE:-}" ]]; then
        export AWS_ACCESS_KEY_ID=$(grep 'access_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_DEFAULT_REGION=$(grep 'region:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    fi
    export AWS_PAGER=""
    start_ms=$(python3 -c 'import time,sys; m=int(sys.argv[1]); print(int((time.time()-m*60)*1000))' "{{minutes}}")
    if [[ -n "{{filter}}" ]]; then
        aws logs filter-log-events \
            --log-group-name /ecs/smart-guitar-backend-api \
            --start-time "${start_ms}" \
            --filter-pattern "{{filter}}" \
            --limit 50 \
            --query 'events[*].message' \
            --output text
    else
        aws logs filter-log-events \
            --log-group-name /ecs/smart-guitar-backend-api \
            --start-time "${start_ms}" \
            --limit 50 \
            --query 'events[*].message' \
            --output text
    fi

# Query recent lyrics generator Lambda logs (finite output). Optional CloudWatch filter pattern.
cw-lyrics-recent minutes="60" filter="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "${AWS_PROFILE:-}" ]]; then
        export AWS_ACCESS_KEY_ID=$(grep 'access_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_SECRET_ACCESS_KEY=$(grep 'secret_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
        export AWS_DEFAULT_REGION=$(grep 'region:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    fi
    export AWS_PAGER=""
    start_ms=$(python3 -c 'import time,sys; m=int(sys.argv[1]); print(int((time.time()-m*60)*1000))' "{{minutes}}")
    if [[ -n "{{filter}}" ]]; then
        aws logs filter-log-events \
            --log-group-name /aws/lambda/smart-guitar-lyrics-generator \
            --start-time "${start_ms}" \
            --filter-pattern "{{filter}}" \
            --limit 50 \
            --query 'events[*].message' \
            --output text
    else
        aws logs filter-log-events \
            --log-group-name /aws/lambda/smart-guitar-lyrics-generator \
            --start-time "${start_ms}" \
            --limit 50 \
            --query 'events[*].message' \
            --output text
    fi

# ── Monitoring ────────────────────────────────────────────────

# Deploy Grafana datasource + dashboards to homeserver and (re)start Grafana
deploy-grafana:
    #!/usr/bin/env bash
    set -euo pipefail

    AWS_ACCESS_KEY=$(grep 'access_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    AWS_SECRET_KEY=$(grep 'secret_key:' "{{project_dir}}/secrets.yml" | awk '{print $2}')
    AWS_REGION=$(grep 'region:' "{{project_dir}}/secrets.yml" | head -1 | awk '{print $2}')

    GRAFANA_BASE="/home/ilia/infra/system/monitoring/grafana"

    echo "Creating directories on homeserver..."
    ssh homeserver "mkdir -p ${GRAFANA_BASE}/provisioning/datasources ${GRAFANA_BASE}/provisioning/dashboards ${GRAFANA_BASE}/dashboards"

    echo "Deploying datasource config..."
    export AWS_ACCESS_KEY AWS_SECRET_KEY AWS_REGION
    envsubst '${AWS_ACCESS_KEY} ${AWS_SECRET_KEY} ${AWS_REGION}' \
        < "{{project_dir}}/grafana/provisioning/datasources/smart_guitar_cloudwatch.yml" \
        | ssh homeserver "cat > ${GRAFANA_BASE}/provisioning/datasources/smart_guitar_cloudwatch.yml"

    echo "Deploying Loki datasource config..."
    scp "{{project_dir}}/grafana/provisioning/datasources/smart_guitar_loki.yml" \
        "homeserver:${GRAFANA_BASE}/provisioning/datasources/smart_guitar_loki.yml"

    echo "Deploying dashboard JSON files..."
    if ls {{project_dir}}/grafana/dashboards/*.json 1>/dev/null 2>&1; then
        scp {{project_dir}}/grafana/dashboards/*.json \
            "homeserver:${GRAFANA_BASE}/dashboards/"
    else
        echo "  No dashboard JSON files found, skipping."
    fi

    echo "Starting Grafana (monitoring profile)..."
    ssh homeserver "cd /home/ilia/infra/system && docker compose --profile monitoring up -d grafana && docker compose --profile monitoring restart grafana"

    # Start Loki if it's configured (optional; not required for CloudWatch dashboards).
    echo "Starting Loki (if configured)..."
    ssh homeserver "cd /home/ilia/infra/system && docker compose --profile monitoring up -d loki 2>/dev/null" || true

    echo "Grafana deployed. Access at http://homeserver:3000"

# Deploy Loki config to homeserver and start it
deploy-loki:
    #!/usr/bin/env bash
    set -euo pipefail

    LOKI_BASE="/home/ilia/infra/system/monitoring/loki"

    echo "Creating Loki directories on homeserver..."
    ssh homeserver "mkdir -p ${LOKI_BASE}"

    echo "Deploying Loki config..."
    scp "{{project_dir}}/grafana/loki/loki-config.yml" \
        "homeserver:${LOKI_BASE}/loki-config.yml"

    echo "Starting Loki (monitoring profile)..."
    ssh homeserver "cd /home/ilia/infra/system && docker compose --profile monitoring up -d loki"

    echo "Loki deployed. Accepting pushes at http://homeserver:3100"
    echo ""
    echo "NOTE: If Loki failed to start, ensure the loki service is defined"
    echo "in /home/ilia/infra/system/docker-compose.yml with profile: monitoring"
    echo ""
    echo "Add this block to the compose file:"
    echo "  loki:"
    echo "    image: grafana/loki:3.3.2"
    echo "    container_name: loki"
    echo "    profiles: [monitoring]"
    echo "    volumes:"
    echo "      - ./monitoring/loki/loki-config.yml:/etc/loki/config.yml:ro"
    echo "      - loki-data:/loki"
    echo "    command: -config.file=/etc/loki/config.yml"
    echo "    ports: [\"3100:3100\"]"
    echo "    restart: unless-stopped"

# Start local Promtail to ship logs to Loki on homeserver
start-promtail:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Starting Promtail (shipping logs to homeserver Loki)..."
    cd "{{project_dir}}"

    # No docker-compose in this repo: run Promtail as a single container.
    # Uses host networking so promtail can push to homeserver:3100 directly.
    docker rm -f smart-guitar-promtail >/dev/null 2>&1 || true
    docker run -d \
        --name smart-guitar-promtail \
        --network host \
        --restart unless-stopped \
        -v "{{project_dir}}/grafana/promtail/promtail-config.yml:/etc/promtail/config.yml:ro" \
        -v "{{project_dir}}/logs:/var/log/smart-guitar:ro" \
        grafana/promtail:3.3.2 \
        -config.file=/etc/promtail/config.yml

    echo "Promtail running. Tailing logs from logs/*.log -> homeserver:3100"

# Stop local Promtail
stop-promtail:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Stopping Promtail..."
    docker rm -f smart-guitar-promtail >/dev/null 2>&1 || true

    echo "Promtail stopped."

# ── Frontend ───────────────────────────────────────────────────

# Install frontend dependencies
setup-frontend:
    cd {{project_dir}}/frontend && npm install

# Start the frontend dev server
dev-frontend:
    cd {{project_dir}}/frontend && npm run dev

# Build frontend for production
build-frontend:
    cd {{project_dir}}/frontend && npm run build

# Deploy all services in parallel (backend, demucs, chords, lyrics, frontend)
deploy-all:
    bash "{{project_dir}}/scripts/deploy/all.sh"

# Deploy homepage (landing page) to S3, invalidate CloudFront, and tag git
deploy-homepage:
    bash "{{project_dir}}/scripts/deploy/homepage.sh"

# Build frontend for production, deploy to S3, invalidate CloudFront, and tag git
deploy-client:
    bash "{{project_dir}}/scripts/deploy/client.sh"

# Run client E2E tests (Playwright)
test-client:
    cd {{project_dir}}/frontend && npx playwright test

# Lint frontend (eslint)
lint-frontend:
    cd {{project_dir}}/frontend && npm run lint

# ── Umbrella testing ───────────────────────────────────────────

# Run local integration tests for all backend/services.
test-integration:
    just test-backend
    just test-demucs
    just test-chords
    just test-lyrics


# Run end-to-end UI tests.
test-e2e:
    just test-client

# Run everything (integration + e2e)
test:
    just test-integration
    just test-e2e

# Generate custom (non-generic) UI art assets using Nano Banana Pro.
# Requires: GEMINI_API_KEY in your environment.
generate-art:
        #!/usr/bin/env bash
        set -euo pipefail
        cd "{{project_dir}}"
        echo "Generating logo..."
        uv run scripts/generate_image.py \
            -r 1K \
            -f frontend/public/logo.png \
            -p "Design a distinctive app logo for 'SMART GUITAR': a stylized electric guitar pick fused with a flame, with subtle string lines inside the pick, ember particles, and a charcoal-black background. High contrast, crisp silhouette, modern, minimal, not clipart, not stock. Centered composition, no text."

        echo "Generating hero background..."
        uv run scripts/generate_image.py \
            -r 2K \
            -f frontend/public/hero-bg.jpg \
            -p "Create a cinematic dark hero background for a music app: a smoky stage with soft bokeh lights, floating embers, warm orange fire glow accents, and lots of negative space for UI text. No people, no instruments in the foreground, no words. Photoreal + stylized, moody, premium, not generic stock."

        echo "Generating album placeholder..."
        uv run scripts/generate_image.py \
            -r 1K \
            -f frontend/public/art/album-placeholder.png \
            -p "Design a unique square album placeholder illustration for a dark fire-themed music app: an abstract guitar silhouette emerging from ember smoke, with a subtle vinyl-circle hint and a glowing fire rim light. Charcoal background, orange/amber highlights, clean, modern, not stock, no text."

        echo "Generating subtle background texture..."
        uv run scripts/generate_image.py \
            -r 1K \
            -f frontend/public/art/bg-texture.png \
            -p "Generate a seamless subtle background texture for a dark UI: charcoal grain + faint smoke wisps + sparse ember specks, very low contrast, tileable, no obvious patterns, no text."

        echo "Done. Assets written to frontend/public/*"

# ── Full Setup + Start ────────────────────────────────────────

# Install everything, run migrations, then start all services
start-app:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "═══ Setting up Inference Demucs ═══"
    ( cd "{{project_dir}}/inference_demucs" && unset VIRTUAL_ENV && uv sync --python 3.11 --extra dev )

    echo ""
    echo "═══ Setting up Chords Generator ═══"
    (
        cd "{{project_dir}}/chords_generator"
        unset VIRTUAL_ENV
        if [ ! -f .venv/pyvenv.cfg ]; then rm -rf .venv && uv venv --python 3.11; fi
        uv pip install numpy setuptools
        export CPLUS_INCLUDE_PATH="$(xcrun --show-sdk-path)/usr/include/c++/v1"
        export ARCHFLAGS="-arch arm64"
        uv sync --extra dev
        mkdir -p "$HOME/Library/Audio/Plug-Ins/Vamp"
    )

    echo ""
    echo "═══ Setting up Lyrics Generator ═══"
    ( cd "{{project_dir}}/lyrics_generator" && unset VIRTUAL_ENV && uv sync --python 3.11 --extra dev )

    echo ""
    echo "═══ Setting up Backend ═══"
    ( cd "{{project_dir}}/backend" && unset VIRTUAL_ENV && uv sync --extra dev )

    echo ""
    echo "═══ Setting up Frontend ═══"
    ( cd "{{project_dir}}/frontend" && npm install )

    echo ""
    echo "═══ Running DB Migrations ═══"
    ( cd "{{project_dir}}/backend" && unset VIRTUAL_ENV && APP_ENV=local uv run alembic upgrade head )

    echo ""
    echo "═══ Killing previous processes on service ports ═══"
    for port in 8000 8001 8002 8003 8004 5173; do
        pids=$(lsof -ti :"$port" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "  Killing PIDs on port $port: $pids"
            echo "$pids" | xargs kill 2>/dev/null || true
        fi
    done
    # Wait until all ports are actually free (up to 10s)
    for port in 8000 8001 8002 8003 8004 5173; do
        for i in $(seq 1 20); do
            if ! lsof -ti :"$port" > /dev/null 2>&1; then break; fi
            sleep 0.5
        done
    done

    echo ""
    echo "═══ Preparing log directory ═══"
    mkdir -p "{{project_dir}}/logs"
    for f in demucs chords lyrics backend frontend; do
        : > "{{project_dir}}/logs/${f}.log"
    done

    echo ""
    echo "═══ Starting All Services ═══"

    cleanup() {
        echo ""
        echo "Shutting down all services..."
        kill $DEMUCS_PID $CHORDS_PID $LYRICS_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        wait $DEMUCS_PID $CHORDS_PID $LYRICS_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        echo "All services stopped."
    }
    trap cleanup EXIT INT TERM

    ( cd "{{project_dir}}/inference_demucs" && unset VIRTUAL_ENV && APP_ENV=dev uv run uvicorn inference_demucs.api:app --reload --host 0.0.0.0 --port 8000 2>&1 | tee "{{project_dir}}/logs/demucs.log" | sed 's/^/[demucs]  /' ) &
    DEMUCS_PID=$!

    ( cd "{{project_dir}}/chords_generator" && unset VIRTUAL_ENV && TF_USE_LEGACY_KERAS=1 APP_ENV=local uv run uvicorn chords_generator.api:app --reload --host 0.0.0.0 --port 8001 2>&1 | tee "{{project_dir}}/logs/chords.log" | sed 's/^/[chords]  /' ) &
    CHORDS_PID=$!

    ( cd "{{project_dir}}/lyrics_generator" && unset VIRTUAL_ENV && APP_ENV=local uv run uvicorn lyrics_generator.api:app --reload --host 0.0.0.0 --port 8003 2>&1 | tee "{{project_dir}}/logs/lyrics.log" | sed 's/^/[lyrics]  /' ) &
    LYRICS_PID=$!

    ( cd "{{project_dir}}/backend" && unset VIRTUAL_ENV && APP_ENV=local SKIP_AUTH=1 uv run uvicorn guitar_player.main:app --reload --host 0.0.0.0 --port 8002 --log-level info 2>&1 | tee "{{project_dir}}/logs/backend.log" | sed 's/^/[backend] /' ) &
    BACKEND_PID=$!

    ( cd "{{project_dir}}/frontend" && npm run dev 2>&1 | tee "{{project_dir}}/logs/frontend.log" | sed 's/^/[frontend]/' ) &
    FRONTEND_PID=$!

    echo ""
    echo "All services starting:"
    echo "  Demucs:    http://localhost:8000"
    echo "  Chords:    http://localhost:8001"
    echo "  Lyrics:    http://localhost:8003"
    echo "  Backend:   http://localhost:8002"
    echo "  Frontend:  http://localhost:5173"
    echo ""
    echo "Logs written to: {{project_dir}}/logs/"
    echo "Press Ctrl+C to stop all services."

    wait

# ── Dev (all services) ─────────────────────────────────────────

# Start all services: demucs (8000), chords (8001), lyrics (8003), backend (8002), frontend (5173)
dev:
    #!/usr/bin/env bash
    set -euo pipefail

    cleanup() {
        echo ""
        echo "Shutting down all services..."
        kill $DEMUCS_PID $CHORDS_PID $LYRICS_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        wait $DEMUCS_PID $CHORDS_PID $LYRICS_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        echo "All services stopped."
    }
    trap cleanup EXIT INT TERM

    mkdir -p "{{project_dir}}/logs"
    for f in demucs chords lyrics backend frontend; do
        : > "{{project_dir}}/logs/${f}.log"
    done

    echo "Starting Inference Demucs on :8000..."
    ( cd "{{project_dir}}/inference_demucs" && APP_ENV=dev uv run uvicorn inference_demucs.api:app --reload --host 0.0.0.0 --port 8000 2>&1 | tee "{{project_dir}}/logs/demucs.log" ) &
    DEMUCS_PID=$!

    echo "Starting Chords Generator on :8001..."
    ( cd "{{project_dir}}/chords_generator" && TF_USE_LEGACY_KERAS=1 APP_ENV=local uv run uvicorn chords_generator.api:app --reload --host 0.0.0.0 --port 8001 2>&1 | tee "{{project_dir}}/logs/chords.log" ) &
    CHORDS_PID=$!

    echo "Starting Lyrics Generator on :8003..."
    ( cd "{{project_dir}}/lyrics_generator" && APP_ENV=local uv run uvicorn lyrics_generator.api:app --reload --host 0.0.0.0 --port 8003 2>&1 | tee "{{project_dir}}/logs/lyrics.log" ) &
    LYRICS_PID=$!

    echo "Starting Backend API on :8002..."
    ( cd "{{project_dir}}/backend" && APP_ENV=local uv run uvicorn guitar_player.main:app --reload --host 0.0.0.0 --port 8002 2>&1 | tee "{{project_dir}}/logs/backend.log" ) &
    BACKEND_PID=$!

    echo "Starting Frontend on :5173..."
    ( cd "{{project_dir}}/frontend" && npm run dev 2>&1 | tee "{{project_dir}}/logs/frontend.log" ) &
    FRONTEND_PID=$!

    echo ""
    echo "All services starting:"
    echo "  Demucs:    http://localhost:8000"
    echo "  Chords:    http://localhost:8001"
    echo "  Lyrics:    http://localhost:8003"
    echo "  Tabs:      http://localhost:8004"
    echo "  Backend:   http://localhost:8002"
    echo "  Frontend:  http://localhost:5173"
    echo ""
    echo "Logs written to: {{project_dir}}/logs/"
    echo "Press Ctrl+C to stop all services."

    wait
