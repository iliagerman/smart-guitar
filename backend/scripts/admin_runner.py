"""Admin runner.

This script talks to the backend's dedicated admin endpoints:
- GET  /api/v1/admin/required
- POST /api/v1/admin/songs/{song_id}/heal
- GET  /api/v1/admin/jobs/{job_id}

Maintains a sliding window of --batch-size concurrent jobs.  As soon as
one song finishes (OK or FAIL), the next candidate is started so there
are always N songs in-flight until the queue is drained.

Auth:
  Authorization: Bearer <admin api key>

Usage is intended via `just admin-run ...`.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

_POLL_INTERVAL = 10.0  # seconds between job status polls


def _now_ms() -> int:
    return int(time.time() * 1000)


def _format_duration(seconds: float) -> str:
    seconds = max(0.0, seconds)
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:d}:{s:02d}"


def _print_progress(
    *,
    total: int,
    counters: dict[str, int],
    in_flight: int,
    started_ms: int,
) -> None:
    processed = counters.get("ok", 0) + counters.get("fail", 0)
    remaining = max(0, total - processed)
    elapsed_s = (_now_ms() - started_ms) / 1000.0
    rate = processed / elapsed_s if elapsed_s > 0 and processed > 0 else 0.0
    eta_s = (remaining / rate) if rate > 0 else None

    eta_part = f" | ETA: {_format_duration(eta_s)}" if eta_s is not None else ""
    print(
        "Progress: "
        f"{processed}/{total} completed "
        f"({counters.get('ok', 0)} ok, {counters.get('fail', 0)} failed)"
        f" | in-flight: {in_flight}"
        f" | remaining: {remaining}"
        f" | elapsed: {_format_duration(elapsed_s)}"
        f"{eta_part}",
        flush=True,
    )


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _fetch_required(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    offset: int,
    limit: int,
    check_storage: bool,
    max_scan: int | None,
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "offset": offset,
        "limit": limit,
        "check_storage": check_storage,
    }
    if max_scan is not None:
        params["max_scan"] = max_scan

    r = await client.get(
        f"{base_url}/api/v1/admin/required",
        params=params,
        headers=_auth_headers(token),
    )
    r.raise_for_status()
    return r.json()


async def _heal_song(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    song_id: str,
    retries: int,
) -> dict[str, Any]:
    """POST /heal and return the response payload. Raises on failure."""
    url = f"{base_url}/api/v1/admin/songs/{song_id}/heal"

    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = await client.post(url, headers=_auth_headers(token))
            if r.status_code >= 500 and attempt < retries:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue

    raise last_err or RuntimeError("heal failed")


async def _poll_job(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    job_id: str,
    song_name: str,
) -> dict[str, Any]:
    """Poll GET /admin/jobs/{job_id} until the job reaches a terminal state."""
    url = f"{base_url}/api/v1/admin/jobs/{job_id}"
    short = song_name.split("/")[-1] if "/" in song_name else song_name

    while True:
        r = await client.get(url, headers=_auth_headers(token))
        r.raise_for_status()
        data = r.json()
        status = data.get("status", "")
        stage = data.get("stage", "")
        progress = data.get("progress", 0)
        print(f"    [{short}] {status} {stage} {progress}%", flush=True)
        if status in ("COMPLETED", "FAILED"):
            return data
        await asyncio.sleep(_POLL_INTERVAL)


def _format_heal_result(payload: dict[str, Any]) -> str:
    """Summarize heal result into a short string."""
    if payload.get("deleted"):
        warnings = payload.get("warnings") or []
        return f"DELETED ({', '.join(warnings)})" if warnings else "DELETED"
    parts: list[str] = []
    if payload.get("audio_thumbnail_fixed"):
        parts.append("audio+thumb")
    if payload.get("reprocess_triggered"):
        parts.append("reprocess")
    if payload.get("lyrics_enqueued"):
        parts.append("lyrics")
    if payload.get("tabs_enqueued"):
        parts.append("tabs")
    warnings = payload.get("warnings") or []
    if warnings:
        parts.append(f"warnings={warnings}")
    return ", ".join(parts) if parts else "no-op"


async def _heal_and_wait(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    song_id: str,
    song_name: str,
    retries: int,
) -> tuple[bool, str]:
    """Heal a single song, poll until done. Returns (success, summary)."""
    sid_short = song_id[:8]

    try:
        heal_resp = await _heal_song(
            client,
            base_url=base_url,
            token=token,
            song_id=song_id,
            retries=retries,
        )
    except Exception as e:  # noqa: BLE001
        msg = f"  FAIL {song_name} ({sid_short}...) -> {e}"
        print(msg, flush=True)
        return False, msg

    summary = _format_heal_result(heal_resp)

    if heal_resp.get("deleted"):
        msg = f"  DEL  {song_name} ({sid_short}...) -> {summary}"
        print(msg, flush=True)
        return True, msg

    job_id = heal_resp.get("job_id")

    if not job_id:
        msg = f"  OK   {song_name} ({sid_short}...) -> {summary}"
        print(msg, flush=True)
        return True, msg

    print(
        f"  HEAL {song_name} ({sid_short}...) -> {summary}; waiting for job {job_id[:8]}...",
        flush=True,
    )
    try:
        job_result = await _poll_job(
            client,
            base_url=base_url,
            token=token,
            job_id=job_id,
            song_name=song_name,
        )
        job_status = job_result.get("status", "?")
        if job_status == "COMPLETED":
            msg = f"  OK   {song_name} ({sid_short}...) -> job completed"
            print(msg, flush=True)
            return True, msg
        else:
            err = job_result.get("error_message", "unknown error")
            msg = f"  FAIL {song_name} ({sid_short}...) -> job {job_status}: {err}"
            print(msg, flush=True)
            return False, msg
    except Exception as e:  # noqa: BLE001
        msg = f"  FAIL {song_name} ({sid_short}...) -> poll error: {e}"
        print(msg, flush=True)
        return False, msg


async def _iter_candidates(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    offset: int,
    fetch_size: int,
    check_storage: bool,
    max_scan: int | None,
    limit_total: int | None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield candidate songs one at a time, fetching pages as needed."""
    emitted = 0
    while True:
        if limit_total is not None and emitted >= limit_total:
            return

        data = await _fetch_required(
            client,
            base_url=base_url,
            token=token,
            offset=offset,
            limit=fetch_size,
            check_storage=check_storage,
            max_scan=max_scan,
        )

        items = data.get("items") or []
        next_offset = data.get("next_offset")
        scanned = data.get("scanned", 0)

        if not items:
            print(f"  No more candidates (scanned {scanned}). Done.", flush=True)
            return

        print(
            f"  Fetched {len(items)} candidates (scanned {scanned}, offset {offset})",
            flush=True,
        )

        for item in items:
            yield item
            emitted += 1
            if limit_total is not None and emitted >= limit_total:
                return

        if next_offset is None:
            return
        offset = int(next_offset)


async def _collect_candidates(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    offset: int,
    fetch_size: int,
    check_storage: bool,
    max_scan: int | None,
    limit_total: int | None,
) -> list[dict[str, Any]]:
    """Fetch and return the full candidate list (up to limit_total).

    This enables accurate progress reporting (remaining count / ETA).
    """

    # API contract: 1-500
    fetch_size = max(1, min(500, fetch_size))

    items_all: list[dict[str, Any]] = []
    async for item in _iter_candidates(
        client,
        base_url=base_url,
        token=token,
        offset=offset,
        fetch_size=fetch_size,
        check_storage=check_storage,
        max_scan=max_scan,
        limit_total=limit_total,
    ):
        items_all.append(item)

    return items_all


def _reap_done(
    pending: set[asyncio.Task],
    counters: dict[str, int],
    failure_log: Path | None,
) -> int:
    """Collect results from finished tasks and update counters.

    Returns the number of tasks reaped.
    """
    done = [t for t in pending if t.done()]
    for t in done:
        pending.discard(t)
        try:
            ok, song_name, reason = t.result()
            if ok:
                counters["ok"] += 1
            else:
                counters["fail"] += 1
                _append_failure(failure_log, song_name, reason)
        except Exception as e:
            counters["fail"] += 1
            _append_failure(failure_log, "?", str(e))

    return len(done)


def _append_failure(log_path: Path | None, song_name: str, reason: str) -> None:
    if log_path is None:
        return
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(log_path, "a") as f:
        f.write(f"{ts}\t{song_name}\t{reason}\n")


async def _run(args: argparse.Namespace) -> int:
    base_url: str = args.base_url.rstrip("/")
    token: str = args.token
    concurrency: int = args.batch_size
    failure_log: Path | None = Path(args.failure_log) if args.failure_log else None

    if failure_log:
        failure_log.parent.mkdir(parents=True, exist_ok=True)
        print(f"Failure log: {failure_log}", flush=True)

    timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0)
    limits = httpx.Limits(
        max_keepalive_connections=concurrency + 5,
        max_connections=concurrency * 2 + 5,
    )

    counters: dict[str, int] = {"ok": 0, "fail": 0}
    started_ms = _now_ms()

    pending: set[asyncio.Task] = set()

    async def _worker(item: dict[str, Any]) -> tuple[bool, str, str]:
        song_name = item.get("song_name", "?")
        ok, summary = await _heal_and_wait(
            client,
            base_url=base_url,
            token=token,
            song_id=str(item["song_id"]),
            song_name=song_name,
            retries=args.retries,
        )
        return ok, song_name, summary

    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        # Prefetch candidates so we can report total/remaining accurately.
        candidates = await _collect_candidates(
            client,
            base_url=base_url,
            token=token,
            offset=args.offset,
            fetch_size=max(100, concurrency * 20),
            check_storage=args.check_storage,
            max_scan=args.max_scan,
            limit_total=args.limit_total,
        )

        total_candidates = len(candidates)
        if total_candidates == 0:
            print("\nDone. 0 songs processed: 0 ok, 0 failed.")
            return 0

        print(f"\nFound {total_candidates} songs to process. Starting...\n", flush=True)

        for item in candidates:
            # If we're at capacity, wait for at least one task to finish.
            while len(pending) >= concurrency:
                await asyncio.sleep(0.5)
                reaped = _reap_done(pending, counters, failure_log)
                if reaped:
                    _print_progress(
                        total=total_candidates,
                        counters=counters,
                        in_flight=len(pending),
                        started_ms=started_ms,
                    )

            task = asyncio.create_task(_worker(item))
            pending.add(task)

        # Wait for remaining in-flight tasks.
        while pending:
            await asyncio.sleep(0.5)
            reaped = _reap_done(pending, counters, failure_log)
            if reaped:
                _print_progress(
                    total=total_candidates,
                    counters=counters,
                    in_flight=len(pending),
                    started_ms=started_ms,
                )

    elapsed_s = (_now_ms() - started_ms) / 1000.0
    total = counters["ok"] + counters["fail"]
    print(
        f"\nDone. {total} songs processed: "
        f"{counters['ok']} ok, {counters['fail']} failed. "
        f"Elapsed: {elapsed_s:.1f}s"
    )

    if failure_log and counters["fail"] > 0:
        print(f"Failed songs written to: {failure_log.resolve()}")

    return 0 if counters["fail"] == 0 else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Admin runner")
    p.add_argument(
        "--base-url", required=True, help="Backend base URL, e.g. http://localhost:8002"
    )
    p.add_argument(
        "--token", required=True, help="Admin API token (Authorization: Bearer)"
    )

    p.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Max songs processing concurrently (sliding window)",
    )

    p.add_argument(
        "--limit-total",
        type=int,
        default=None,
        help="Stop after healing this many songs total (default: no limit)",
    )
    p.add_argument(
        "--offset", type=int, default=0, help="DB offset to start scanning from"
    )

    p.add_argument(
        "--check-storage",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Also treat keys pointing to missing files as candidates",
    )
    p.add_argument(
        "--max-scan",
        type=int,
        default=None,
        help="Max songs to scan per required-list call (default is backend-chosen)",
    )

    p.add_argument(
        "--retries", type=int, default=1, help="Retries for transient failures"
    )
    p.add_argument(
        "--failure-log",
        type=str,
        default="failures.log",
        help="Path to write failed songs (TSV: timestamp, song_name, reason). "
        "Set to empty string to disable. Default: failures.log",
    )

    args = p.parse_args(argv)

    if args.batch_size < 1:
        raise SystemExit("--batch-size must be >= 1")

    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
