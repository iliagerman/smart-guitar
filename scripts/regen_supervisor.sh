#!/usr/bin/env bash
# Self-healing supervisor for the bulk regeneration run — LOW-IMPACT topology.
# One lyrics instance, one driver, everything at background QoS (taskpolicy -b)
# so the machine stays responsive for interactive use. Pauses work entirely
# while the system load is high (someone is using the machine hard).
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${PROJECT_DIR}/regen_state.jsonl"
TOTAL_SONGS=1099
INTERVAL=120
# Don't (re)start heavy work while 1-minute load is above this.
MAX_LOAD_TO_START=20

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

health() { curl -s -m 5 -o /dev/null -w "%{http_code}" "http://localhost:$1/health" 2>/dev/null; }

current_load() { sysctl -n vm.loadavg | awk '{print int($2)}'; }

restart_chords() {
    log "RESTART chords service (8001, background QoS)"
    cd "${PROJECT_DIR}/chords_generator"
    TF_USE_LEGACY_KERAS=1 APP_ENV=local OMP_NUM_THREADS=2 nohup taskpolicy -b uv run uvicorn chords_generator.api:app \
        --host 0.0.0.0 --port 8001 >> /tmp/chords_service.log 2>&1 &
}

restart_lyrics() {
    log "RESTART lyrics service (8003, background QoS)"
    cd "${PROJECT_DIR}/lyrics_generator"
    APP_ENV=local OMP_NUM_THREADS=4 nohup taskpolicy -b uv run uvicorn lyrics_generator.api:app \
        --host 0.0.0.0 --port 8003 >> /tmp/lyrics_service.log 2>&1 &
}

resume_driver() {
    log "RESUME bulk regeneration driver (single, background QoS)"
    cd "${PROJECT_DIR}/backend"
    APP_ENV=local nohup taskpolicy -b uv run python scripts/bulk_regenerate.py \
        --shard 0/1 --lyrics-host localhost:8003 \
        --state-file ../regen_state.jsonl \
        >> /tmp/bulk_regen_0.log 2>&1 &
}

log "supervisor started (interval ${INTERVAL}s, LOW-IMPACT single instance)"
while true; do
    done_count=$(grep -c '"status": "done"' "${STATE_FILE}" 2>/dev/null || true)
    failed_count=$(grep -c '"status": "failed"' "${STATE_FILE}" 2>/dev/null || true)
    processed=$(( ${done_count:-0} + ${failed_count:-0} ))

    if [ "${processed}" -ge "${TOTAL_SONGS}" ]; then
        log "ALL ${TOTAL_SONGS} songs processed (${done_count} done, ${failed_count} failed) — supervisor exiting"
        exit 0
    fi

    load=$(current_load)
    if [ "${load}" -gt "${MAX_LOAD_TO_START}" ]; then
        log "load ${load} > ${MAX_LOAD_TO_START} — holding off on restarts this cycle"
        sleep "${INTERVAL}"
        continue
    fi

    if [ "$(health 8001)" != "200" ]; then restart_chords; sleep 20; fi
    if [ "$(health 8003)" != "200" ]; then restart_lyrics; sleep 30; fi

    if ! pgrep -f "bulk_regenerate.py" > /dev/null 2>&1; then
        sleep 5
        resume_driver
        sleep 20
    fi

    sleep "${INTERVAL}"
done
