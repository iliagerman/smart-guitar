#!/usr/bin/env bash
# Self-healing supervisor for the bulk regeneration run (two-shard topology).
# Restarts the chords service and both lyrics service instances if their
# health checks fail, and resumes either sharded driver if it exits while
# songs remain.
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${PROJECT_DIR}/regen_state.jsonl"
TOTAL_SONGS=1099
INTERVAL=120

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

health() { curl -s -m 5 -o /dev/null -w "%{http_code}" "http://localhost:$1/health" 2>/dev/null; }

restart_chords() {
    log "RESTART chords service (8001)"
    cd "${PROJECT_DIR}/chords_generator"
    TF_USE_LEGACY_KERAS=1 APP_ENV=local nohup uv run uvicorn chords_generator.api:app \
        --host 0.0.0.0 --port 8001 >> /tmp/chords_service.log 2>&1 &
}

restart_lyrics() {
    local port="$1"
    log "RESTART lyrics service (${port})"
    cd "${PROJECT_DIR}/lyrics_generator"
    APP_ENV=local nohup uv run uvicorn lyrics_generator.api:app \
        --host 0.0.0.0 --port "${port}" >> "/tmp/lyrics_service_${port}.log" 2>&1 &
}

resume_shard() {
    local shard="$1" port="$2"
    log "RESUME bulk regeneration shard ${shard} -> lyrics ${port}"
    cd "${PROJECT_DIR}/backend"
    APP_ENV=local nohup uv run python scripts/bulk_regenerate.py \
        --shard "${shard}/2" --lyrics-host "localhost:${port}" \
        --state-file ../regen_state.jsonl \
        >> "/tmp/bulk_regen_${shard}.log" 2>&1 &
}

log "supervisor started (interval ${INTERVAL}s, 2 shards)"
while true; do
    # grep -c prints "0" AND exits 1 on zero matches — `|| echo 0` would
    # produce "0\n0" and break the arithmetic. Default only when empty.
    done_count=$(grep -c '"status": "done"' "${STATE_FILE}" 2>/dev/null || true)
    failed_count=$(grep -c '"status": "failed"' "${STATE_FILE}" 2>/dev/null || true)
    processed=$(( ${done_count:-0} + ${failed_count:-0} ))

    if [ "${processed}" -ge "${TOTAL_SONGS}" ]; then
        log "ALL ${TOTAL_SONGS} songs processed (${done_count} done, ${failed_count} failed) — supervisor exiting"
        exit 0
    fi

    if [ "$(health 8001)" != "200" ]; then restart_chords; sleep 20; fi
    if [ "$(health 8003)" != "200" ]; then restart_lyrics 8003; sleep 30; fi
    if [ "$(health 8013)" != "200" ]; then restart_lyrics 8013; sleep 30; fi

    if ! pgrep -f "bulk_regenerate.py --shard 0/2" > /dev/null 2>&1; then
        sleep 5; resume_shard 0 8003; sleep 20
    fi
    if ! pgrep -f "bulk_regenerate.py --shard 1/2" > /dev/null 2>&1; then
        sleep 5; resume_shard 1 8013; sleep 20
    fi

    sleep "${INTERVAL}"
done
