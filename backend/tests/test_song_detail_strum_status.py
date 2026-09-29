"""Song detail reports a strum lookup as pending only while one is running."""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from guitar_player.schemas.records import SongRecord
from guitar_player.services.song_service.detail import STRUM_FETCH_PENDING_SECONDS, _load_songsterr_data


def _song(**fields: object) -> SongRecord:
    now = datetime.now(timezone.utc)
    return SongRecord(
        id=uuid.uuid4(), created_at=now, updated_at=now,
        title="Wonderwall", artist="Oasis", song_name="oasis/wonderwall", **fields,
    )


def _storage(has_file: bool = False) -> MagicMock:
    storage = MagicMock()
    storage.file_exists.return_value = has_file
    storage.read_json.return_value = {}
    return storage


def test_no_lookup_running_means_no_pattern_rather_than_pending():
    assert _load_songsterr_data(_storage(), _song())["songsterr_status"] == "unavailable"


def test_a_lookup_that_just_started_is_pending():
    song = _song(external_strums_attempted_at=datetime.now(timezone.utc) - timedelta(seconds=5))
    assert _load_songsterr_data(_storage(), song)["songsterr_status"] is None


def test_a_lookup_that_never_finished_stops_being_pending():
    started = datetime.now(timezone.utc) - timedelta(seconds=STRUM_FETCH_PENDING_SECONDS + 30)
    song = _song(external_strums_attempted_at=started)
    assert _load_songsterr_data(_storage(), song)["songsterr_status"] == "unavailable"


def test_stored_patterns_are_ready_and_failures_stay_failed():
    ready = _song(external_strums_key="oasis/wonderwall/songsterr_data.json")
    assert _load_songsterr_data(_storage(has_file=True), ready)["songsterr_status"] == "ready"
    failed = _song(external_strums_failed=True)
    assert _load_songsterr_data(_storage(), failed)["songsterr_status"] == "failed"
