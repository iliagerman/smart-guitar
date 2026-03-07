"""Per-request context propagated via contextvars.

Values set here are automatically included in every JSON log line
via the RequestContextFilter (registered in main.py).

asyncio.create_task() copies the current context automatically (Python 3.7+),
so background tasks spawned during a request inherit these values.
"""

import logging
import uuid
from contextvars import ContextVar

# Unique ID for each request (UUID4 string). Always set by middleware.
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# Fallback ID used for logs emitted outside of an HTTP request context
# (startup/shutdown/background/system logs). This prevents log lines without
# request_id, which simplifies Grafana queries and troubleshooting.
_PROCESS_REQUEST_ID = str(uuid.uuid4())

# Cognito ``sub`` claim. Set by auth dependency; empty for unauthenticated routes.
user_id_var: ContextVar[str] = ContextVar("user_id", default="")

# User email. Set by auth dependency; empty for unauthenticated routes.
user_email_var: ContextVar[str] = ContextVar("user_email", default="")


class RequestContextFilter(logging.Filter):
    """Inject request context into every log record.

    python-json-logger's JsonFormatter automatically serialises extra
    attributes on the LogRecord, so these appear in the JSON output
    without any format-string changes.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        rid = request_id_var.get()
        record.request_id = rid or _PROCESS_REQUEST_ID  # type: ignore[attr-defined]
        # Backward/ops compatibility: some dashboards use 'rid' instead of 'request_id'.
        record.rid = record.request_id  # type: ignore[attr-defined]
        record.user_id = user_id_var.get()  # type: ignore[attr-defined]
        record.user_email = user_email_var.get()  # type: ignore[attr-defined]
        return True
