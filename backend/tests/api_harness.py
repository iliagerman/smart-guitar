"""In-process API harness: the app's routers over httpx, signed in as a chosen member.

Mirrors main.py's router order without its startup side effects (local bucket
sync, telemetry), so tests exercise real routing, auth guards and the test DB.
"""

import json
import shutil
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from guitar_player.app_state import set_storage
from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.subscription_dao import SubscriptionDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import close_db, init_db
from guitar_player.exceptions import NotFoundError
from guitar_player.routers import admin, favorites, jobs, practice, setlists, songs, subscription
from guitar_player.schemas.records import SongRecord
from guitar_player.storage import StorageBackend


class ApiHarness:
    def __init__(self, app: FastAPI, client: httpx.AsyncClient) -> None:
        self.app = app
        self.client = client

    def sign_in(self, user: CurrentUser) -> None:
        self.app.dependency_overrides[get_current_user] = lambda: user


def build_app(api_prefix: str) -> FastAPI:
    app = FastAPI()

    @app.exception_handler(NotFoundError)
    async def _not_found(_request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    for module in (setlists, songs, practice, jobs, favorites, admin, subscription):
        app.include_router(module.router, prefix=api_prefix)
    return app


async def open_harness(
    settings: Settings, storage: StorageBackend,
) -> AsyncIterator[ApiHarness]:
    init_db(settings)
    set_storage(storage)
    app = build_app(settings.app.api_prefix)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield ApiHarness(app, client)
    finally:
        await close_db()


async def create_member(
    factory: async_sessionmaker[AsyncSession], *, pro: bool,
) -> CurrentUser:
    """A provisioned member on an active trial (pro) or with the trial over (free)."""
    user = CurrentUser(sub=f"test-member-{uuid.uuid4().hex[:10]}", email=f"{uuid.uuid4().hex[:10]}@member.test")
    async with factory() as session:
        user_dao = UserDAO(session)
        record = await user_dao.get_or_create(user.sub, user.email)
        if not pro:
            await user_dao.update_by_id(
                record.id, trial_ends_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
        await session.commit()
    return user


async def add_subscription(
    factory: async_sessionmaker[AsyncSession], user: CurrentUser, *,
    plan_type: str, period_end: datetime, status: str = "active",
) -> None:
    async with factory() as session:
        db_user = await UserDAO(session).get_by_cognito_sub(user.sub)
        await SubscriptionDAO(session).create(
            user_id=db_user.id,
            provider="allpay",
            external_subscription_id=str(uuid.uuid4()),
            external_customer_id=str(db_user.id),
            status=status,
            plan_type=plan_type,
            current_period_start=period_end - timedelta(days=365),
            current_period_end=period_end,
        )
        await session.commit()


def bucket_path(settings: Settings) -> Path:
    return Path(settings.storage.base_path or "../local_bucket_test").resolve()


# Song columns pointing at the fixture file of the same name.
_KEY_FIELDS = {
    "audio.mp3": "audio_key",
    "cover.jpg": "thumbnail_key",
    "chords.json": "chords_key",
    "vocals.mp3": "vocals_key",
    "guitar.mp3": "guitar_key",
    "drums.mp3": "drums_key",
    "bass.mp3": "bass_key",
    "piano.mp3": "piano_key",
    "other.mp3": "other_key",
}


class SongFactory:
    """Creates song rows (and their storage files) and removes them afterwards."""

    def __init__(self, factory: async_sessionmaker[AsyncSession], settings: Settings) -> None:
        self._factory = factory
        self._base = bucket_path(settings)
        self._root = f"test_api_{uuid.uuid4().hex[:8]}"
        self._song_ids: list[uuid.UUID] = []

    async def create(self, files: dict[str, object | bytes] | None = None, **fields: object) -> SongRecord:
        """Song under a fresh folder; ``files`` maps file names to JSON data or raw bytes."""
        song_name = f"{self._root}/song_{len(self._song_ids)}"
        folder = self._base / song_name
        folder.mkdir(parents=True, exist_ok=True)
        for name, data in (files or {}).items():
            path = folder / name
            if isinstance(data, bytes):
                path.write_bytes(data)
            else:
                path.write_text(json.dumps(data))
        for name in files or {}:
            if name in _KEY_FIELDS:
                fields.setdefault(_KEY_FIELDS[name], f"{song_name}/{name}")
        fields.setdefault("title", f"Test Song {len(self._song_ids)}")
        async with self._factory() as session:
            song = await SongDAO(session).create(song_name=song_name, **fields)
            await session.commit()
        self._song_ids.append(song.id)
        return song

    async def get(self, song_id: uuid.UUID) -> SongRecord:
        async with self._factory() as session:
            return await SongDAO(session).get_by_id(song_id)

    async def cleanup(self) -> None:
        async with self._factory() as session:
            await SongDAO(session).delete_by_ids(self._song_ids)
            await session.commit()
        shutil.rmtree(self._base / self._root, ignore_errors=True)
