"""Shared FastAPI dependency injection wiring."""

import asyncio
from collections.abc import AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.config import Settings, get_settings
from guitar_player.database import get_session_factory
from guitar_player.services.artwork_service import ArtworkService
from guitar_player.services.cognito_auth_service import CognitoAuthService
from guitar_player.services.favorite_service import FavoriteService
from guitar_player.services.job_service import JobService
from guitar_player.services.llm_service import LlmService
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.song_service import SongService
from guitar_player.services.allpay_provider import AllPayProvider
from guitar_player.services.payment_provider import PaymentProviderProtocol
from guitar_player.services.subscription_service import PaddleProvider
from guitar_player.services.telegram_service import TelegramService
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend

# Storage singleton lives in app_state to avoid circular imports.
from guitar_player.app_state import get_storage, set_storage


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async DB session, auto-committing on success.

    Uses ``asyncio.shield`` on ``session.close()`` so that client disconnects
    (which cancel the request task) cannot leave the connection checked-out.
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        try:
            await asyncio.shield(session.close())
        except asyncio.CancelledError:
            pass  # close() continues in background via shield


def get_cognito_auth_service(
    settings: Settings = Depends(get_settings),
) -> CognitoAuthService:
    return CognitoAuthService(settings)


def get_telegram_service(
    settings: Settings = Depends(get_settings),
) -> TelegramService:
    return TelegramService(settings.telegram)


def get_artwork_service() -> ArtworkService:
    return ArtworkService()


_youtube_service: YoutubeService | None = None


def get_youtube_service(
    settings: Settings = Depends(get_settings),
) -> YoutubeService:
    global _youtube_service
    if _youtube_service is None:
        _youtube_service = YoutubeService(
            proxy=settings.youtube.proxy,
            cookies_file=settings.youtube.cookies_file,
            use_cookies_for_public_videos=settings.youtube.use_cookies_for_public_videos,
            max_duration_seconds=settings.youtube.max_duration_seconds,
            po_token_provider_enabled=settings.youtube.po_token_provider_enabled,
            po_token_provider_base_url=settings.youtube.po_token_provider_base_url,
            po_token_provider_disable_innertube=settings.youtube.po_token_provider_disable_innertube,
            sleep_requests_seconds=settings.youtube.sleep_requests_seconds,
            sleep_interval_seconds=settings.youtube.sleep_interval_seconds,
            max_sleep_interval_seconds=settings.youtube.max_sleep_interval_seconds,
        )
    return _youtube_service


def get_llm_service(settings: Settings = Depends(get_settings)) -> LlmService:
    return LlmService(settings)


def get_processing_service(
    settings: Settings = Depends(get_settings),
) -> ProcessingService:
    return ProcessingService(settings)


def get_song_service(
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
    youtube: YoutubeService = Depends(get_youtube_service),
    llm: LlmService = Depends(get_llm_service),
    artwork: ArtworkService = Depends(get_artwork_service),
) -> SongService:
    return SongService(session, storage, youtube, llm, artwork)


def get_favorite_service(
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> FavoriteService:
    return FavoriteService(session, storage)


def get_job_service(
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> JobService:
    return JobService(session, storage)


def get_payment_provider(
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    telegram: TelegramService = Depends(get_telegram_service),
) -> PaymentProviderProtocol:
    if settings.allpay.enabled:
        return AllPayProvider(session, settings, telegram)
    return PaddleProvider(session, settings, telegram)
