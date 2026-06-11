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
MAX_LOAD_TO_START=100

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

health() { curl -s -m 5 -o /dev/null -w "%{http_code}" "http://localhost:$1/health" 2>/dev/null; }

current_load() { sysctl -n vm.loadavg | awk '{print int($2)}'; }

restart_chords() {
    log "RESTART chords service (8001, background QoS)"
    cd "${PROJECT_DIR}/chords_generator"
    TF_USE_LEGACY_KERAS=1 APP_ENV=local OMP_NUM_THREADS=2 nohup taskpolicy -c utility uv run uvicorn chords_generator.api:app \
        --host 0.0.0.0 --port 8001 >> /tmp/chords_service.log 2>&1 &
}

restart_lyrics() {
    log "RESTART lyrics service (8003, background QoS)"
    cd "${PROJECT_DIR}/lyrics_generator"
    APP_ENV=local OMP_NUM_THREADS=4 nohup taskpolicy -c utility uv run uvicorn lyrics_generator.api:app \
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

# ensure_service <port> <pgrep-pattern> <restart-fn> <stuck-counter-name>
# Restart only when NO process exists — services boot slowly under background
# QoS and firing twice races two listeners for the port. If a process exists
# but stays unhealthy for 5 cycles, force-kill and restart it.
ensure_service() {
    local port="$1" pattern="$2" restart_fn="$3" counter_name="$4"
    if [ "$(health "${port}")" = "200" ]; then
        eval "${counter_name}=0"
        return
    fi
    if ! pgrep -f "${pattern}" > /dev/null 2>&1; then
        "${restart_fn}"
        eval "${counter_name}=0"
        sleep 10
        return
    fi
    local count
    eval "count=\${${counter_name}}"
    count=$((count + 1))
    eval "${counter_name}=${count}"
    if [ "${count}" -ge 8 ]; then
        log "service on ${port} stuck (alive but unhealthy ${count} cycles) — force restart"
        pkill -f "${pattern}"
        sleep 5
        "${restart_fn}"
        eval "${counter_name}=0"
    fi
}

stuck_chords=0
stuck_lyrics=0

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

    ensure_service 8001 "uvicorn chords_generator" restart_chords stuck_chords
    ensure_service 8003 "uvicorn lyrics_generator" restart_lyrics stuck_lyrics

    if ! pgrep -f "bulk_regenerate.py" > /dev/null 2>&1; then
        sleep 5
        resume_driver
        sleep 20
    fi

    sleep "${INTERVAL}"
done
