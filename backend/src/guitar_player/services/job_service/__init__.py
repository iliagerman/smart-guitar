"""Job service package -- re-exports the public API for backward compatibility."""

from .admin_heal import start_startup_admin_heal
from .background_tasks import (
    enqueue_external_strums_fetch,
    enqueue_job_processing,
    enqueue_lyrics_transcription,
    enqueue_static_chords_fetch,
    enqueue_tabs_generation,
    enqueue_vocals_guitar_merge,
    enqueue_web_chords_fetch,
)
from .constants import DEFAULT_REQUESTED_OUTPUTS
from .constants import LIGHTWEIGHT_TASK_COOLDOWN_SECONDS as LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
from .core import JobService
from .helpers import score_tutorial_link, search_youtube_tutorial
from .stem_processing import complete_job, fail_job, process_job

# Backward-compatible aliases used by tests and other modules.
_score_tutorial_link = score_tutorial_link
_search_youtube_tutorial = search_youtube_tutorial
_complete_job = complete_job
_fail_job = fail_job
_process_job = process_job
_LIGHTWEIGHT_TASK_COOLDOWN_SECONDS = LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
_enqueue_lyrics_transcription = enqueue_lyrics_transcription
_enqueue_tabs_generation = enqueue_tabs_generation
_enqueue_vocals_guitar_merge = enqueue_vocals_guitar_merge
_enqueue_job_processing = enqueue_job_processing
_enqueue_external_strums_fetch = enqueue_external_strums_fetch
_enqueue_web_chords_fetch = enqueue_web_chords_fetch
_enqueue_static_chords_fetch = enqueue_static_chords_fetch

__all__ = [
    "JobService",
    "start_startup_admin_heal",
    "DEFAULT_REQUESTED_OUTPUTS",
    # Private aliases kept for backward compatibility with tests.
    "_score_tutorial_link",
    "_search_youtube_tutorial",
    "_complete_job",
    "_fail_job",
    "_process_job",
    "_LIGHTWEIGHT_TASK_COOLDOWN_SECONDS",
    "_enqueue_lyrics_transcription",
    "_enqueue_tabs_generation",
    "_enqueue_vocals_guitar_merge",
    "_enqueue_job_processing",
    "_enqueue_external_strums_fetch",
    "_enqueue_web_chords_fetch",
    "_enqueue_static_chords_fetch",
]
