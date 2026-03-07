import csv
import json
import os
import re


def slugify(text):
    text = text.lower()
    # Support Hebrew and Latin characters
    text = re.sub(r"[^a-z0-9\u0590-\u05ff\s-]", "", text)
    text = re.sub(r"\s+", "_", text).strip("_")
    return text


def process_songs():
    songs = []
    songs_dir = "/Users/iliagerman/Work/personal_projects/guitar_player/songs_list"

    # 1. Process popular_hebrew_songs.csv
    hebrew_path = os.path.join(songs_dir, "popular_hebrew_songs.csv")
    if os.path.exists(hebrew_path):
        with open(hebrew_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                title = row.get("song_name", "").strip()
                artist = row.get("artist_name", "").strip()
                if title and artist:
                    songs.append(
                        {
                            "title": title,
                            "artist": artist,
                            "genre": "pop",  # Default genre as it's not in the file
                            "song_name": f"{slugify(artist)}/{slugify(title)}",
                        }
                    )

    # 2. Process popular_100.csv
    pop_path = os.path.join(songs_dir, "popular_100.csv")
    if os.path.exists(pop_path):
        with open(pop_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                title = row.get("song", "").strip()
                artist = row.get("artist", "").strip()
                if title and artist:
                    songs.append(
                        {
                            "title": title,
                            "artist": artist,
                            "genre": "pop",
                            "song_name": f"{slugify(artist)}/{slugify(title)}",
                        }
                    )

    # 3. Process liked.csv
    liked_path = os.path.join(songs_dir, "liked.csv")
    if os.path.exists(liked_path):
        with open(liked_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                title = row.get("Track Name", "").strip()
                artist = row.get("Artist Name(s)", "").strip()
                if title and artist:
                    songs.append(
                        {
                            "title": title,
                            "artist": artist,
                            "genre": "rock",  # Guessing rock/folk for liked songs
                            "song_name": f"{slugify(artist)}/{slugify(title)}",
                        }
                    )

    # 4. Process top_100_guitar_songs.md
    md_path = os.path.join(songs_dir, "top_100_guitar_songs.md")
    if os.path.exists(md_path):
        with open(md_path, "r", encoding="utf-8") as f:
            for line in f:
                match = re.search(r"\|\s*\d+\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|", line)
                if match:
                    artist = match.group(1).strip()
                    title = match.group(2).strip()
                    if artist.lower() != "artist":  # Skip header
                        songs.append(
                            {
                                "title": title,
                                "artist": artist,
                                "genre": "rock",
                                "song_name": f"{slugify(artist)}/{slugify(title)}",
                            }
                        )

    # Deduplicate by song_name
    seen = set()
    unique_songs = []
    for s in songs:
        if s["song_name"] not in seen:
            seen.add(s["song_name"])
            unique_songs.append(s)

    with open(os.path.join(songs_dir, "all_songs.json"), "w", encoding="utf-8") as f:
        json.dump(unique_songs, f, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    process_songs()
