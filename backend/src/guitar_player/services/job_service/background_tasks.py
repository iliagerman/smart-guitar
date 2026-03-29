"""Background task registry and enqueue functions."""

import asyncio
import html
import logging
import uuid

logger = logging.getLogger(__name__)

# Global task registries -- prevent duplicate background work.
BACKGROUND_TASKS: set[asyncio.Task] = set()
MERGE_TASKS: dict[uuid.UUID, asyncio.Task] = {}
LYRICS_TASKS: dict[uuid.UUID, asyncio.Task] = {}
TABS_TASKS: dict[uuid.UUID, asyncio.Task] = {}
EXTERNAL_STRUMS_TASKS: dict[uuid.UUID, asyncio.Task] = {}
WEB_CHORDS_TASKS: dict[uuid.UUID, asyncio.Task] = {}


async def _notify_telegram_error(task_label: str, exc: BaseException) -> None:
    """Send a background-task failure notification to Telegram."""
    try:
        from guitar_player.config import get_settings
        from guitar_player.services.telegram_service import TelegramService

        settings = get_settings()
        telegram = TelegramService(settings.telegram)
        exc_type = html.escape(type(exc).__name__)
        exc_msg = html.escape(str(exc)[:500])
        await telegram.send_error(
            f"<b>Background Task Failed</b>\n"
            f"<b>Task:</b> {html.escape(task_label)}\n"
            f"<b>Type:</b> <code>{exc_type}</code>\n"
            f"<b>Message:</b> {exc_msg}"
        )
    except Exception:
        logger.debug("Failed to send Telegram notification for background task", exc_info=True)


def track_task(task: asyncio.Task) -> None:
    """Register a background task for lifecycle tracking."""
    BACKGROUND_TASKS.add(task)

    def _done(t: asyncio.Task) -> None:
        BACKGROUND_TASKS.discard(t)

    task.add_done_callback(_done)


def _enqueue_singleton(
    registry: dict[uuid.UUID, asyncio.Task],
    key: uuid.UUID,
    coro,
    label: str = "",
) -> None:
    """Create a task only if no existing task is running for *key*."""
    existing = registry.get(key)
    if existing and not existing.done():
        return

    task = asyncio.create_task(coro)
    registry[key] = task
    task_label = label or task.get_name()

    def _done(t: asyncio.Task) -> None:
        if registry.get(key) is t:
            registry.pop(key, None)
        if not t.cancelled():
            exc = t.exception()
            if exc is not None:
                logger.warning("Background task %s failed: %s", task_label, exc)
                asyncio.create_task(_notify_telegram_error(task_label, exc))

    task.add_done_callback(_done)


def enqueue_job_processing(job_id: uuid.UUID) -> None:
    """Fire-and-forget job processing in the background."""
    from .stem_processing import process_job

    task = asyncio.create_task(process_job(job_id))
    track_task(task)


def enqueue_vocals_guitar_merge(song_id: uuid.UUID) -> None:
    """Fire-and-forget vocals+guitar merge in the background."""
    from .external_data import merge_vocals_guitar_only

    _enqueue_singleton(
        MERGE_TASKS, song_id, merge_vocals_guitar_only(song_id),
        label=f"vocals_guitar_merge({song_id})",
    )


def enqueue_lyrics_transcription(
    song_id: uuid.UUID, *, quick_only: bool = False
) -> None:
    """Fire-and-forget lyrics transcription in the background."""
    from .lyrics_chords import transcribe_lyrics_only

    _enqueue_singleton(
        LYRICS_TASKS, song_id, transcribe_lyrics_only(song_id, quick_only=quick_only),
        label=f"lyrics_transcription({song_id})",
    )


def enqueue_tabs_generation(song_id: uuid.UUID) -> None:
    """Fire-and-forget tabs generation in the background."""
    from .external_data import generate_tabs_only

    _enqueue_singleton(
        TABS_TASKS, song_id, generate_tabs_only(song_id),
        label=f"tabs_generation({song_id})",
    )


def enqueue_external_strums_fetch(song_id: uuid.UUID) -> None:
    """Fire-and-forget external strums fetch in the background."""
    from .external_data import fetch_external_strums

    _enqueue_singleton(
        EXTERNAL_STRUMS_TASKS, song_id, fetch_external_strums(song_id),
        label=f"external_strums({song_id})",
    )


def enqueue_web_chords_fetch(song_id: uuid.UUID) -> None:
    """Fire-and-forget Gemini chord detection in the background."""
    from .lyrics_chords import fetch_gemini_chords

    _enqueue_singleton(
        WEB_CHORDS_TASKS, song_id, fetch_gemini_chords(song_id),
        label=f"web_chords({song_id})",
    )
