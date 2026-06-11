#!/usr/bin/env bash
# Self-healing supervisor for the bulk regeneration run.
# Restarts the chords/lyrics services if their health checks fail and
# resumes the bulk-regenerate driver if it exits while songs remain.
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${PROJECT_DIR}/regen_state.jsonl"
TOTAL_SONGS=1099
INTERVAL=120

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

health() { curl -s -m 5 -o /dev/null -w "%{http_code}" "http://localhost:$1/health" 2>/dev/null; }

restart_chords() {
    log "RESTART chords service"
    cd "${PROJECT_DIR}/chords_generator"
    TF_USE_LEGACY_KERAS=1 APP_ENV=local nohup uv run uvicorn chords_generator.api:app \
        --host 0.0.0.0 --port 8001 >> /tmp/chords_service.log 2>&1 &
}

restart_lyrics() {
    log "RESTART lyrics service"
    cd "${PROJECT_DIR}/lyrics_generator"
    APP_ENV=local nohup uv run uvicorn lyrics_generator.api:app \
        --host 0.0.0.0 --port 8003 >> /tmp/lyrics_service.log 2>&1 &
}

resume_bulk() {
    log "RESUME bulk regeneration"
    cd "${PROJECT_DIR}"
    nohup just bulk-regenerate "--concurrency 2 --state-file ../regen_state.jsonl" \
        >> /tmp/bulk_regen.log 2>&1 &
}

log "supervisor started (interval ${INTERVAL}s)"
while true; do
    done_count=$(grep -c '"status": "done"' "${STATE_FILE}" 2>/dev/null || echo 0)
    failed_count=$(grep -c '"status": "failed"' "${STATE_FILE}" 2>/dev/null || echo 0)
    processed=$((done_count + failed_count))

    if [ "${processed}" -ge "${TOTAL_SONGS}" ]; then
        log "ALL ${TOTAL_SONGS} songs processed (${done_count} done, ${failed_count} failed) — supervisor exiting"
        exit 0
    fi

    if [ "$(health 8001)" != "200" ]; then restart_chords; sleep 20; fi
    if [ "$(health 8003)" != "200" ]; then restart_lyrics; sleep 30; fi

    if ! pgrep -f "scripts/bulk_regenerate.py" > /dev/null 2>&1; then
        # Give services a moment if they were just restarted, then resume.
        sleep 10
        resume_bulk
        sleep 30
    fi

    sleep "${INTERVAL}"
done
