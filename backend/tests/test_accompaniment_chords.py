"""Unit tests: chord recognition uses the accompaniment stem mix when stems
are already cached, without adding latency to a fresh separation.

``_run_separation_and_chords`` runs stem separation and chord recognition
concurrently for a fresh job (real Demucs work), so stems aren't available in
time there without adding real wall-clock latency. But when stems already
exist on disk (``stems_already_ok``), separation resolves near-instantly via
``_cached_separation`` -- that's the only branch where feeding the
accompaniment mix (bass/guitar/piano/other, no vocals/drums) to the recognizer
is free. These tests exercise that branch directly with fakes; no live
services required.
"""

from __future__ import annotations

import uuid

import pytest

from guitar_player.app_state import set_storage
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import stem_processing
from guitar_player.services.processing_service import ChordRecognitionResult, SeparationResult

SONG_NAME = "test_artist/test_accompaniment_song"
AUDIO_PATH = f"{SONG_NAME}/audio.mp3"


class _FakeProcessing:
    """Records recognize_chords calls; no real HTTP calls made."""

    def __init__(self) -> None:
        self.recognize_calls: list[tuple[str, list[str] | None]] = []

    async def separate_stems(self, audio_path: str, requested_outputs=None) -> SeparationResult:
        raise AssertionError("separate_stems should not be called when stems are cached")

    async def recognize_chords(
        self, input_path: str, accompaniment_stem_paths: list[str] | None = None,
    ) -> ChordRecognitionResult:
        self.recognize_calls.append((input_path, accompaniment_stem_paths))
        return ChordRecognitionResult(chords=[], output_path=f"{input_path}.chords.json")

    async def detect_bass(self, bass_path: str, chords_path: str) -> None:
        return None


class _FreshFakeProcessing(_FakeProcessing):
    """Fresh separation: separate_stems is expected to actually run."""

    async def separate_stems(self, audio_path: str, requested_outputs=None) -> SeparationResult:
        return SeparationResult(stems=[], output_path=f"{SONG_NAME}/")


def _stub_file_exists(present: set[str]):
    def file_exists(key: str) -> bool:
        return key in present

    return file_exists


@pytest.fixture
async def _db(settings, storage):
    factory = init_db(settings)
    set_storage(storage)
    yield factory
    await close_db()


@pytest.mark.asyncio
async def test_recognize_chords_gets_accompaniment_stems_when_stems_cached(
    _db, storage, monkeypatch,
):
    """Stems already on disk -> chords are recognized on bass/guitar/piano/other."""
    present = {
        AUDIO_PATH,
        f"{SONG_NAME}/vocals.mp3",
        f"{SONG_NAME}/drums.mp3",
        f"{SONG_NAME}/bass.mp3",
        f"{SONG_NAME}/piano.mp3",
        f"{SONG_NAME}/other.mp3",
        f"{SONG_NAME}/guitar.mp3",
    }
    monkeypatch.setattr(storage, "file_exists", _stub_file_exists(present))
    processing = _FakeProcessing()

    await stem_processing._run_separation_and_chords(
        processing, storage, AUDIO_PATH, SONG_NAME,
        job_id=uuid.uuid4(), demucs_requested_outputs=[], job_start_time=0.0,
    )

    assert len(processing.recognize_calls) == 1
    input_path, stem_paths = processing.recognize_calls[0]
    assert input_path == AUDIO_PATH
    assert stem_paths is not None
    assert set(stem_paths) == {
        f"{SONG_NAME}/bass.mp3", f"{SONG_NAME}/guitar.mp3",
        f"{SONG_NAME}/piano.mp3", f"{SONG_NAME}/other.mp3",
    }
    # Vocals/drums are explicitly excluded from the accompaniment mix.
    assert f"{SONG_NAME}/vocals.mp3" not in stem_paths
    assert f"{SONG_NAME}/drums.mp3" not in stem_paths


@pytest.mark.asyncio
async def test_recognize_chords_gets_no_stem_paths_for_fresh_separation(
    _db, storage, monkeypatch,
):
    """Stems not yet on disk -> full mix, no accompaniment_stem_paths (unchanged)."""
    present = {AUDIO_PATH}  # no stems present -> fresh separation path
    monkeypatch.setattr(storage, "file_exists", _stub_file_exists(present))
    processing = _FreshFakeProcessing()

    await stem_processing._run_separation_and_chords(
        processing, storage, AUDIO_PATH, SONG_NAME,
        job_id=uuid.uuid4(), demucs_requested_outputs=[], job_start_time=0.0,
    )

    assert len(processing.recognize_calls) == 1
    input_path, stem_paths = processing.recognize_calls[0]
    assert input_path == AUDIO_PATH
    assert stem_paths is None
