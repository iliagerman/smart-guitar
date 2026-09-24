"""LocalStorage.list_files must match the S3 backend it stands in for.

S3 list_objects_v2 returns every key under a prefix, at any depth. LocalStorage
only listed the immediate directory, so code that walks the whole bucket --
`list_files("")` -- saw nothing at all locally while working fine in prod.
"""

from guitar_player.storage import LocalStorage


class _Settings:
    class storage:
        base_path = ""

    class presigned_url:
        expiry_seconds = 900


def _storage(base) -> LocalStorage:
    settings = _Settings()
    settings.storage = type("s", (), {"base_path": str(base), "cdn_base_url": None})()
    return LocalStorage(settings)


def test_lists_keys_nested_under_the_prefix(tmp_path):
    song = tmp_path / "artist" / "song"
    (song / "jobs" / "abc").mkdir(parents=True)
    (song / "lyrics.json").write_text("{}")
    (song / "jobs" / "abc" / "job_status.json").write_text("{}")

    keys = _storage(tmp_path).list_files("artist/song")

    assert sorted(keys) == [
        "artist/song/jobs/abc/job_status.json",
        "artist/song/lyrics.json",
    ]


def test_empty_prefix_walks_the_whole_bucket(tmp_path):
    (tmp_path / "a" / "one").mkdir(parents=True)
    (tmp_path / "b" / "two").mkdir(parents=True)
    (tmp_path / "a" / "one" / "lyrics.json").write_text("{}")
    (tmp_path / "b" / "two" / "lyrics.json").write_text("{}")

    keys = _storage(tmp_path).list_files("")

    assert sorted(keys) == ["a/one/lyrics.json", "b/two/lyrics.json"]


def test_missing_prefix_returns_nothing(tmp_path):
    assert _storage(tmp_path).list_files("nope") == []
