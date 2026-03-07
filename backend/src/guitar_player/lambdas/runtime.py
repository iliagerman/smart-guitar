"""Shared Lambda runtime initialization.

Initializes:
- JSON logging (CloudWatch-friendly)
- Settings
- DB engine + session factory
- Storage singleton (LocalStorage in dev, S3Storage in prod)

Lambdas can then reuse existing backend services/DAOs via safe_session().
"""

from __future__ import annotations

import logging
import sys
from typing import Final

from pythonjsonlogger.json import JsonFormatter

from guitar_player.app_state import set_storage
from guitar_player.config import get_settings
from guitar_player.database import init_db
from guitar_player.request_context import RequestContextFilter
from guitar_player.storage import create_storage

_initialized: bool = False


class _ServiceFilter(logging.Filter):
    def __init__(self, service_name: str) -> None:
        super().__init__()
        self._service_name: Final[str] = service_name

    def filter(self, record: logging.LogRecord) -> bool:
        # Ensure every record has a service field.
        if not hasattr(record, "service"):
            record.service = self._service_name
        return True


def setup_logging(*, level: str, service_name: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
        static_fields={"service": service_name},
    )
    handler.setFormatter(formatter)
    handler.addFilter(RequestContextFilter())
    handler.addFilter(_ServiceFilter(service_name))

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Make boto3 and urllib3 less chatty unless explicitly requested.
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def init_runtime(*, service_name: str) -> None:
    global _initialized
    if _initialized:
        return

    settings = get_settings()

    setup_logging(level=settings.app.log_level, service_name=service_name)

    # DB
    init_db(settings)

    # Storage
    storage = create_storage(settings)
    storage.init()
    set_storage(storage)

    _initialized = True

    logging.getLogger(__name__).info(
        "Lambda runtime initialized",
        extra={
            "event_type": "lambda_runtime_init",
            "environment": settings.environment,
            "storage_backend": settings.storage.backend,
            "service": service_name,
        },
    )
