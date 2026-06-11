"""Tests for bucket catalog discovery (used by scripts/rebuild_local_db.py).

The bucket has two layouts:
  * old: {artist}/{song}/audio.mp3
  * new: {artist}/{song}/{youtube_id}/audio.mp3

Discovery must find both, derive youtube_id from the new layout's path or the
old layout's '{ytid}.jpg' thumbnail, and resolve title/artist from the seed
catalog, matched online metadata, or prettified folder names — in that order.
"""

from __future__ import annotations

import json
from pathlib import Path

from guitar_player.services.bucket_catalog import (
    discover_song_dirs,
    prettify_folder_name,
    resolve_metadata,
)


def _make_song(base: Path, rel: str, files: list[str]) -> Path:
    d = base / rel
    d.mkdir(parents=True)
    for f in files:
        (d / f).write_bytes(b"x")
    return d


def test_discovers_old_and_new_layouts(tmp_path):
    _make_song(tmp_path, "abba/dancing_queen", ["audio.mp3", "xFrGuyw1V8s.jpg"])
    _make_song(tmp_path, "abba/waterloo/Sj_9CiNkkn4", ["audio.mp3", "cover.jpg"])
    _make_song(tmp_path, "no_audio/empty_dir", ["notes.txt"])

    discovered = discover_song_dirs(tmp_path)
    by_name = {d.song_name: d for d in discovered}

    assert set(by_name) == {"abba/dancing_queen", "abba/waterloo/Sj_9CiNkkn4"}
    # Old layout: youtube_id extracted from the thumbnail filename.
    assert by_name["abba/dancing_queen"].youtube_id == "xFrGuyw1V8s"
    # New layout: youtube_id is the third path component.
    assert by_name["abba/waterloo/Sj_9CiNkkn4"].youtube_id == "Sj_9CiNkkn4"


def test_resolve_metadata_prefers_seed_catalog(tmp_path):
    _make_song(tmp_path, "eagles/hotel_california", ["audio.mp3"])
    seed_index = {
        "eagles/hotel_california": {
            "title": "Hotel California", "artist": "Eagles", "genre": "rock",
        }
    }
    title, artist, genre = resolve_metadata(
        tmp_path, "eagles/hotel_california", seed_index
    )
    assert (title, artist, genre) == ("Hotel California", "Eagles", "rock")


def test_resolve_metadata_uses_matched_online_data(tmp_path):
    d = _make_song(tmp_path, "abba/waterloo/Sj_9CiNkkn4", ["audio.mp3"])
    (d / "static_chords.json").write_text(json.dumps({
        "matched_artist": "ABBA", "matched_title": "Waterloo",
    }))
    title, artist, genre = resolve_metadata(
        tmp_path, "abba/waterloo/Sj_9CiNkkn4", {}
    )
    assert (title, artist) == ("Waterloo", "ABBA")
    assert genre is None


def test_resolve_metadata_falls_back_to_prettified_folders(tmp_path):
    _make_song(tmp_path, "pink_floyd/wish_you_were_here", ["audio.mp3"])
    title, artist, genre = resolve_metadata(
        tmp_path, "pink_floyd/wish_you_were_here", {}
    )
    assert title == "Wish You Were Here"
    assert artist == "Pink Floyd"


def test_prettify_folder_name():
    assert prettify_folder_name("knocking_on_heavens_door") == "Knocking On Heavens Door"
    assert prettify_folder_name("שיר_בעברית") == "שיר בעברית"
