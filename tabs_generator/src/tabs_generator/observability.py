"""Runtime Observer integration."""

import logging
import os
from pathlib import Path

import yaml
from fastapi import FastAPI
from runtime_observer import init_runtime_observer

logger = logging.getLogger(__name__)

_RUNTIME_OBSERVER_MAPPINGS = {
    "api_key": "RUNTIME_OBSERVER_API_KEY",
    "endpoint": "RUNTIME_OBSERVER_ENDPOINT",
    "project_name": "RUNTIME_OBSERVER_PROJECT_NAME",
    "enabled": "RUNTIME_OBSERVER_ENABLED",
    "capture_mode": "RUNTIME_OBSERVER_CAPTURE_MODE",
    "environment": "RUNTIME_OBSERVER_ENVIRONMENT",
    "log_levels": "RUNTIME_OBSERVER_LOG_LEVELS",
}


def _candidate_secrets_paths() -> list[Path]:
    """Ordered list of paths that may contain a runtime_observer block.

    The deploy flow writes the merged secrets to different locations per service
    (backend → /app/config/prod.secrets.yml, lyrics → /app/secrets.yml, etc.) and
    on the homeserver the file is mounted at /app/config/secrets.yml. We probe
    every known layout before falling back to walking the source tree (which is
    what supports local dev where secrets.yml lives at the repo root).
    """
    candidates: list[Path] = []
    for base in (Path("/app"), Path("/var/task")):
        candidates.append(base / "config" / "prod.secrets.yml")
        candidates.append(base / "config" / "secrets.yml")
        candidates.append(base / "secrets.yml")
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / "prod.secrets.yml")
        candidates.append(parent / "secrets.yml")
    return candidates


def _load_runtime_observer_env() -> None:
    """Populate Runtime Observer env vars from a yaml secrets file when not already set."""
    if os.environ.get("RUNTIME_OBSERVER_API_KEY"):
        logger.info("Runtime Observer: using API key from environment")
        return

    seen: set[Path] = set()
    for candidate in _candidate_secrets_paths():
        if not candidate.exists():
            continue
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        data = yaml.safe_load(resolved.read_text()) or {}
        config = data.get("runtime_observer") or {}
        if not isinstance(config, dict) or not config.get("api_key"):
            continue
        for key, env_name in _RUNTIME_OBSERVER_MAPPINGS.items():
            value = config.get(key)
            if value is not None and not os.environ.get(env_name):
                os.environ[env_name] = str(value)
        logger.info("Runtime Observer: loaded config from %s", resolved)
        return

    logger.warning(
        "Runtime Observer: no API key in env or any secrets file — SDK will stay silent",
    )


def instrument_runtime_observer(app: FastAPI, service_name: str) -> None:
    """Attach Runtime Observer to a FastAPI app when configured."""
    try:
        _load_runtime_observer_env()
        os.environ.setdefault("RUNTIME_OBSERVER_SERVICE_NAME", service_name)
        observer = init_runtime_observer.from_env(service_name=service_name)
        observer.instrument_fastapi(app)
        logger.info("Runtime Observer: instrumented FastAPI app %s", service_name)
    except Exception:
        logger.exception("Runtime Observer instrumentation failed")
