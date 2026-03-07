"""Export inline SEED_SONGS from seed_service.py to a JSON file.

Why: seed_service.py became very large and noisy due to an embedded seed list.
This script extracts the literal list and writes it to:

    backend/src/guitar_player/services/seed_songs.json

Run via:
    just export-seed-songs

Notes:
- Uses only stdlib (ast/json/pathlib).
- Dedupes by song_name (case-insensitive, normalized slashes).
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any


def _find_repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "justfile").is_file():
            return parent
    raise RuntimeError("Could not locate repo root (missing justfile in parents)")


def _seed_song_key(entry: dict[str, Any]) -> str:
    song_name = str(entry.get("song_name") or "").strip().replace("\\", "/")
    song_name = re.sub(r"/+", "/", song_name)
    return song_name.casefold()


def _extract_seed_songs_literal(seed_service_path: Path) -> list[dict[str, Any]]:
    src = seed_service_path.read_text(encoding="utf-8")
    mod = ast.parse(src, filename=str(seed_service_path))

    seed_value: ast.AST | None = None

    for node in mod.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "SEED_SONGS":
                seed_value = node.value
                break
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "SEED_SONGS":
                    seed_value = node.value
                    break
            if seed_value is not None:
                break

    if seed_value is None:
        raise RuntimeError("Could not find SEED_SONGS assignment in seed_service.py")

    songs = ast.literal_eval(seed_value)
    if not isinstance(songs, list):
        raise TypeError(f"SEED_SONGS must be a list, got {type(songs)}")
    return songs


def main() -> None:
    repo = _find_repo_root()
    seed_py = repo / "backend/src/guitar_player/services/seed_service.py"
    out_json = repo / "backend/src/guitar_player/services/seed_songs.json"

    if not seed_py.is_file():
        raise FileNotFoundError(seed_py)

    songs = _extract_seed_songs_literal(seed_py)

    normalized: list[dict[str, str]] = []
    skipped = 0
    for s in songs:
        if not isinstance(s, dict):
            skipped += 1
            continue
        title = str(s.get("title") or "").strip()
        artist = str(s.get("artist") or "").strip()
        genre = str(s.get("genre") or "other").strip() or "other"
        song_name = str(s.get("song_name") or "").strip()
        if not (title and artist and song_name):
            skipped += 1
            continue
        normalized.append(
            {
                "title": title,
                "artist": artist,
                "genre": genre,
                "song_name": song_name,
            }
        )

    # De-dupe by song_name
    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    dupes = 0
    for entry in normalized:
        key = _seed_song_key(entry)
        if not key or key in seen:
            dupes += 1
            continue
        seen.add(key)
        deduped.append(entry)

    out_json.write_text(
        json.dumps(deduped, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"Wrote {len(deduped)} songs to {out_json} "
        f"(skipped {skipped} invalid items, dropped {dupes} duplicates)"
    )


if __name__ == "__main__":
    main()
