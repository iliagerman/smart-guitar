"""Merge all_songs.json into seed_songs.json without duplicates.

Deduplicates by song_name (case-insensitive). seed_songs.json entries win on conflict.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "backend" / "src" / "guitar_player" / "services" / "seed_songs.json"
ALL_SONGS = ROOT / "songs_list" / "all_songs.json"

seed = json.loads(SEED.read_text("utf-8"))
extra = json.loads(ALL_SONGS.read_text("utf-8"))

seen = {s["song_name"].strip().casefold() for s in seed}
added = 0

for entry in extra:
    key = entry["song_name"].strip().casefold()
    if key not in seen:
        seed.append(entry)
        seen.add(key)
        added += 1

SEED.write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n", "utf-8")
print(f"Done: {added} songs added, {len(seed)} total in seed_songs.json")
