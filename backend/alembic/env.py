"""Alembic env.py — runs migrations against the configured database.

Automatically creates the target database if it doesn't exist.
"""

from logging.config import fileConfig
from urllib.parse import urlparse, urlunparse

from alembic import context
from sqlalchemy import create_engine, text

from guitar_player.config import load_settings
from guitar_player.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_sync_url() -> str:
    """Get the sync DB URL from app config."""
    settings = load_settings()
    url = settings.db.url
    if not url:
        raise RuntimeError("Database URL not configured")
    if "asyncpg" in url:
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    return url


def _ensure_database_exists(url: str) -> None:
    """Connect to the 'postgres' default DB and CREATE DATABASE if needed."""
    parsed = urlparse(url)
    db_name = parsed.path.lstrip("/")
    if not db_name:
        return

    # Build URL pointing to the default 'postgres' database
    maintenance_url = urlunparse(parsed._replace(path="/postgres"))
    engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :db"), {"db": db_name}
        )
        if not result.scalar():
            conn.execute(text(f'CREATE DATABASE "{db_name}" TEMPLATE template0'))
    engine.dispose()


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL without DB connection."""
    url = _get_sync_url()
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — connect to DB."""
    url = _get_sync_url()
    _ensure_database_exists(url)
    connectable = create_engine(url)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
