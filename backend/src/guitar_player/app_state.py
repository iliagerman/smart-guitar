"""Application-wide runtime state.

Keep this module free of FastAPI/router/service imports to avoid circular imports.

Currently used for the storage backend singleton, which is initialized at app
startup and accessed from request handlers and background tasks.
"""

from __future__ import annotations

from guitar_player.storage import StorageBackend

_storage: StorageBackend | None = None


def set_storage(storage: StorageBackend) -> None:
    """Set the storage singleton (called at startup)."""
    global _storage
    _storage = storage


def get_storage() -> StorageBackend:
    """Return the storage singleton."""
    if _storage is None:
        raise RuntimeError("Storage not initialized")
    return _storage
