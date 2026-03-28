#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "google-genai>=1.0.0",
#   "httpx>=0.27.0",
# ]
# ///
"""Experiment: hybrid chord detection combining Gemini + autochord timing + Tavily.

Three modes:
  1. gemini-only:  Gemini detects chords from audio (baseline)
  2. hybrid:       Gemini chord names mapped onto autochord change-point timestamps
  3. tavily-boost: Gemini receives audio + Tavily chord sheet content for better context

Examples:
  uv run scripts/gemini_hybrid_experiment.py -s local_bucket/america/a_horse_with_no_name/na47wMFfQCo
  uv run scripts/gemini_hybrid_experiment.py -s local_bucket/vance_joy/riptide --tavily-key $TAVILY_API_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def _gemini_key(provided: str | None) -> str | None:
    return provided or os.environ.get("GEMINI_API_KEY")


def _tavily_key(provided: str | None) -> str | None:
    return provided or os.environ.get("TAVILY_API_KEY")


# ── Autochord timestamp extraction ──────────────────────────────


def load_autochord_timestamps(song_dir: Path) -> list[dict]:
    """Load autochord chords.json and return change-point timestamps."""
    chords_path = song_dir / "chords.json"
    if not chords_path.is_file():
        print(f"  No chords.json found in {song_dir}", file=sys.stderr)
        return []
    with open(chords_path) as f:
        return json.load(f)


def extract_change_points(autochord: list[dict]) -> list[float]:
    """Extract unique chord change timestamps from autochord output."""
    points: list[float] = []
    prev_chord = None
    for entry in autochord:
        chord = entry.get("chord", "N")
        if chord != prev_chord:
            points.append(entry["start_time"])
            prev_chord = chord
    return points


# ── Tavily chord sheet search ───────────────────────────────────


def search_tavily_chords(
    artist: str, title: str, tavily_api_key: str,
) -> str | None:
    """Search Tavily for chord sheet content."""
    import httpx

    query = f"{title} {artist} guitar chords lyrics complete"
    print(f"  Tavily search: {query!r}")
    try:
        resp = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": tavily_api_key,
                "query": query,
                "search_depth": "advanced",
                "max_results": 3,
                "include_answer": "advanced",
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"  Tavily search failed: {exc}", file=sys.stderr)
        return None

    snippets: list[str] = []
    answer = data.get("answer", "")
    if answer:
        snippets.append(f"Tavily AI Answer:\n{answer}")
    for result in data.get("results", [])[:3]:
        content = result.get("content", "")
        source = result.get("url", "")
        if content:
            snippets.append(f"Source: {source}\n{content}")

    if not snippets:
        return None

    combined = "\n\n---\n\n".join(snippets)
    print(f"  Tavily returned {len(snippets)} snippets ({len(combined)} chars)")
    return combined


# ── Gemini chord detection ──────────────────────────────────────


_GEMINI_PROMPT_BASE = """\
Listen to this audio file carefully. You are an expert guitarist and music \
transcriber.

**Task:** Identify every chord change in the song with precise timestamps.

**Output format:** Return ONLY a JSON object (no markdown fences) with this structure:
{
  "chords": [
    {"start_time": 0.0, "end_time": 2.5, "chord": "Em"},
    {"start_time": 2.5, "end_time": 5.1, "chord": "D6/9"}
  ],
  "key": "Em",
  "capo": 0,
  "tuning": "Standard",
  "bpm": 120,
  "time_signature": "4/4",
  "notes": "Playing tips"
}

**Rules:**
- Use standard chord notation: C, Am, G7, Dmaj7, F#m, Bb, D6/9, etc.
- Timestamps in seconds with at least 1 decimal place.
- Every moment must be covered — no gaps between chords.
- Use "N" for silence/percussion-only sections.
- Merge consecutive identical chords.
- If a capo is commonly used, list chord SHAPES (not sounding pitch).
- Be very precise about WHEN chords change — listen for actual harmonic \
shifts in the audio, not just bar lines. Chord durations will vary.
"""


def _build_prompt_with_timing_hints(
    change_points: list[float],
) -> str:
    """Add autochord timing hints to the prompt."""
    if not change_points:
        return _GEMINI_PROMPT_BASE

    # Format change points compactly
    points_str = ", ".join(f"{t:.1f}" for t in change_points[:100])
    if len(change_points) > 100:
        points_str += f" ... ({len(change_points)} total)"

    return (
        _GEMINI_PROMPT_BASE
        + "\n\n**IMPORTANT timing hints from audio analysis:**\n"
        "An automated chord detector found harmonic changes at approximately "
        f"these timestamps (in seconds): [{points_str}]\n"
        "Use these as a guide for WHEN chords change — they are roughly correct "
        "for timing but the chord NAMES from the detector are unreliable. "
        "Trust your own ears for the chord names, but use these timestamps "
        "to anchor your timing. Not all change points may be real (some are noise), "
        "and some real changes may be missing."
    )


def _build_prompt_with_tavily(
    tavily_content: str,
    change_points: list[float],
) -> str:
    """Add both Tavily chord sheet and timing hints to the prompt."""
    prompt = _build_prompt_with_timing_hints(change_points)
    return (
        prompt
        + "\n\n**Reference chord sheet from the web:**\n"
        "The following chord sheet was found online for this song. "
        "Use it to VERIFY your chord detection — the chord names here are "
        "authoritative. Map these chords onto the audio timestamps.\n\n"
        f"{tavily_content[:8000]}"  # Limit to avoid token overflow
    )


def call_gemini(
    audio_path: Path,
    api_key: str,
    prompt: str,
    label: str = "",
) -> dict:
    """Send audio + prompt to Gemini and parse JSON response."""
    from google import genai
    from google.genai import types

    tag = f"[{label}] " if label else ""
    print(f"  {tag}Uploading {audio_path.name}...")

    client = genai.Client(api_key=api_key)
    uploaded = client.files.upload(file=audio_path)

    while uploaded.state.name == "PROCESSING":
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name == "FAILED":
        print(f"  {tag}File processing failed", file=sys.stderr)
        return {}

    print(f"  {tag}Sending to Gemini 2.5 Pro...")
    start = time.monotonic()

    response = client.models.generate_content(
        model="gemini-2.5-pro",
        contents=[
            types.Content(
                parts=[
                    types.Part.from_uri(
                        file_uri=uploaded.uri,
                        mime_type=uploaded.mime_type,
                    ),
                    types.Part.from_text(text=prompt),
                ],
            ),
        ],
        config=types.GenerateContentConfig(temperature=0.1),
    )

    elapsed = time.monotonic() - start
    print(f"  {tag}Response in {elapsed:.1f}s")

    try:
        client.files.delete(name=uploaded.name)
    except Exception:
        pass

    text = response.text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        text = "\n".join(lines)

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        print(f"  {tag}Failed to parse JSON. Raw:", file=sys.stderr)
        print(text[:500], file=sys.stderr)
        return {}

    result["_meta"] = {
        "mode": label,
        "detection_time_seconds": round(elapsed, 1),
    }
    return result


# ── Hybrid merge: Gemini names + autochord timing ──────────────


def merge_gemini_with_autochord(
    gemini_result: dict,
    autochord: list[dict],
) -> list[dict]:
    """Map Gemini's chord names onto autochord's change-point timestamps.

    Strategy:
    1. Extract autochord change points (when harmony shifts).
    2. Extract Gemini's ordered chord sequence (correct names).
    3. Map Gemini names onto autochord timestamps sequentially.
    4. Handle count mismatches gracefully.
    """
    gemini_chords = gemini_result.get("chords", [])
    if not gemini_chords or not autochord:
        return gemini_chords

    # Extract Gemini's ordered chord name sequence (skip N, deduplicate consecutive)
    gemini_sequence: list[str] = []
    prev = None
    for entry in gemini_chords:
        chord = entry.get("chord", "N")
        if chord != "N" and chord != prev:
            gemini_sequence.append(chord)
            prev = chord

    # Extract autochord change points with their time ranges
    autochord_segments: list[dict] = []
    prev_chord = None
    for entry in autochord:
        chord = entry.get("chord", "N")
        if chord != prev_chord:
            autochord_segments.append({
                "start_time": entry["start_time"],
                "end_time": entry["end_time"],
                "original_chord": chord,
            })
            prev_chord = chord
        elif autochord_segments:
            # Extend the end time of the current segment
            autochord_segments[-1]["end_time"] = entry["end_time"]

    if not autochord_segments or not gemini_sequence:
        return gemini_chords

    # Map Gemini names onto autochord segments
    # Use a cycling approach: repeat the Gemini sequence to cover all segments
    merged: list[dict] = []
    gemini_idx = 0
    pattern_length = len(gemini_sequence)

    for seg in autochord_segments:
        if seg["original_chord"] == "N":
            merged.append({
                "start_time": round(seg["start_time"], 3),
                "end_time": round(seg["end_time"], 3),
                "chord": "N",
            })
            continue

        # Pick the next Gemini chord name (cycling through the sequence)
        chord_name = gemini_sequence[gemini_idx % pattern_length]
        merged.append({
            "start_time": round(seg["start_time"], 3),
            "end_time": round(seg["end_time"], 3),
            "chord": chord_name,
        })
        gemini_idx += 1

    # Post-process: merge consecutive same-chord entries
    cleaned: list[dict] = []
    for entry in merged:
        if cleaned and cleaned[-1]["chord"] == entry["chord"]:
            cleaned[-1]["end_time"] = entry["end_time"]
        else:
            cleaned.append(entry)

    return cleaned


# ── Display helpers ─────────────────────────────────────────────


def print_chords(chords: list[dict], label: str, max_rows: int = 40) -> None:
    """Print a chord table."""
    unique = sorted({c["chord"] for c in chords if c.get("chord") != "N"})
    print(f"\n{'─' * 60}")
    print(f"  {label}")
    print(f"  {len(chords)} entries | Unique: {', '.join(unique)}")
    print(f"{'─' * 60}")
    print(f"  {'Start':>7}  {'End':>7}  {'Dur':>5}  Chord")
    for entry in chords[:max_rows]:
        start = entry.get("start_time", 0)
        end = entry.get("end_time", 0)
        dur = end - start
        print(f"  {start:7.1f}  {end:7.1f}  {dur:5.1f}  {entry['chord']}")
    if len(chords) > max_rows:
        print(f"  ... ({len(chords) - max_rows} more)")


def compare_all(results: dict[str, list[dict]]) -> None:
    """Compare chord sequences across all modes."""
    print(f"\n{'=' * 60}")
    print("  COMPARISON SUMMARY")
    print(f"{'=' * 60}")
    for label, chords in results.items():
        unique = sorted({c["chord"] for c in chords if c.get("chord") != "N"})
        coverage = max((c.get("end_time", 0) for c in chords), default=0)
        print(f"  {label:30s}  {len(chords):4d} entries  "
              f"Chords: {', '.join(unique):40s}  Coverage: {coverage:.0f}s")


# ── Metadata extraction ─────────────────────────────────────────


def extract_song_info(song_dir: Path) -> tuple[str, str]:
    """Try to extract artist and title from directory structure."""
    # Expected: local_bucket/artist/title/youtube_id/
    parts = song_dir.parts
    # Find local_bucket index
    try:
        bucket_idx = parts.index("local_bucket")
        artist = parts[bucket_idx + 1] if len(parts) > bucket_idx + 1 else "unknown"
        title = parts[bucket_idx + 2] if len(parts) > bucket_idx + 2 else "unknown"
        return artist.replace("_", " "), title.replace("_", " ")
    except (ValueError, IndexError):
        return "unknown", "unknown"


# ── Main ────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Hybrid chord detection: Gemini + autochord timing + Tavily",
    )
    parser.add_argument(
        "--song-dir", "-s", required=True,
        help="Path to song directory (contains audio.mp3, chords.json, etc.)",
    )
    parser.add_argument("--output", "-o", help="Output JSON file path")
    parser.add_argument("--gemini-key", help="Overrides GEMINI_API_KEY")
    parser.add_argument("--tavily-key", help="Overrides TAVILY_API_KEY (enables tavily-boost mode)")
    parser.add_argument(
        "--modes", nargs="+",
        default=["gemini-only", "hybrid", "tavily-boost"],
        choices=["gemini-only", "hybrid", "tavily-boost"],
        help="Which modes to run (default: all)",
    )
    args = parser.parse_args()

    song_dir = Path(args.song_dir)
    # If the dir has audio.mp3, use it directly; otherwise look for subdirs
    audio_path = song_dir / "audio.mp3"
    if not audio_path.is_file():
        # Try to find audio.mp3 in a subdirectory (youtube_id)
        subdirs = [d for d in song_dir.iterdir() if d.is_dir()]
        for sub in subdirs:
            candidate = sub / "audio.mp3"
            if candidate.is_file():
                song_dir = sub
                audio_path = candidate
                break
    if not audio_path.is_file():
        print(f"No audio.mp3 found in {song_dir}", file=sys.stderr)
        return 1

    gemini_key = _gemini_key(args.gemini_key)
    if not gemini_key:
        print("Missing GEMINI_API_KEY", file=sys.stderr)
        return 1

    tavily_key = _tavily_key(args.tavily_key)
    artist, title = extract_song_info(song_dir)
    print(f"Song: {title} by {artist}")
    print(f"Audio: {audio_path}")

    # Load autochord data
    autochord = load_autochord_timestamps(song_dir)
    change_points = extract_change_points(autochord)
    print(f"Autochord: {len(autochord)} entries, {len(change_points)} change points")

    results: dict[str, list[dict]] = {}
    full_results: dict[str, dict] = {}

    # Load existing autochord as reference
    if autochord:
        results["autochord (reference)"] = autochord

    # ── Mode 1: Gemini only ──────────────────────────────────
    if "gemini-only" in args.modes:
        print(f"\n{'=' * 60}")
        print("  MODE 1: Gemini Only (no hints)")
        print(f"{'=' * 60}")
        gemini_result = call_gemini(
            audio_path, gemini_key, _GEMINI_PROMPT_BASE, "gemini-only",
        )
        if gemini_result:
            full_results["gemini-only"] = gemini_result
            results["gemini-only"] = gemini_result.get("chords", [])
            print_chords(results["gemini-only"], "Gemini Only")

    # ── Mode 2: Hybrid (Gemini names + autochord timing) ─────
    if "hybrid" in args.modes and autochord:
        print(f"\n{'=' * 60}")
        print("  MODE 2: Hybrid (Gemini names + autochord timing)")
        print(f"{'=' * 60}")

        # Use Gemini with timing hints for better accuracy
        prompt = _build_prompt_with_timing_hints(change_points)
        gemini_with_hints = call_gemini(
            audio_path, gemini_key, prompt, "hybrid-gemini",
        )
        if gemini_with_hints:
            full_results["hybrid-gemini-raw"] = gemini_with_hints

            # Merge: take Gemini's chord names, map onto autochord timestamps
            merged = merge_gemini_with_autochord(gemini_with_hints, autochord)
            results["hybrid (merged)"] = merged
            print_chords(merged, "Hybrid: Gemini names on autochord timing")

            # Also show Gemini-with-hints raw (before merge)
            results["hybrid-gemini-raw"] = gemini_with_hints.get("chords", [])
            print_chords(
                results["hybrid-gemini-raw"],
                "Hybrid: Gemini with timing hints (raw, before merge)",
            )

    # ── Mode 3: Tavily-boosted Gemini ────────────────────────
    if "tavily-boost" in args.modes:
        print(f"\n{'=' * 60}")
        print("  MODE 3: Tavily-Boosted Gemini")
        print(f"{'=' * 60}")

        tavily_content = None

        # Try to load existing Tavily/web data from songsterr_data.json
        songsterr_path = song_dir / "songsterr_data.json"
        if songsterr_path.is_file():
            with open(songsterr_path) as f:
                songsterr = json.load(f)
            # Check for strum_notes or lyrics_text as chord context
            notes = songsterr.get("strum_notes", "")
            if notes:
                print(f"  Found existing strum notes ({len(notes)} chars)")
                tavily_content = f"Playing notes from tutorial:\n{notes}"

        # Try live Tavily search if key provided and no existing data
        if not tavily_content and tavily_key:
            tavily_content = search_tavily_chords(artist, title, tavily_key)

        if tavily_content:
            prompt = _build_prompt_with_tavily(tavily_content, change_points)
            gemini_tavily = call_gemini(
                audio_path, gemini_key, prompt, "tavily-boost",
            )
            if gemini_tavily:
                full_results["tavily-boost"] = gemini_tavily
                results["tavily-boost"] = gemini_tavily.get("chords", [])
                print_chords(results["tavily-boost"], "Tavily-Boosted Gemini")

                # Also create merged version
                if autochord:
                    merged_tavily = merge_gemini_with_autochord(
                        gemini_tavily, autochord,
                    )
                    results["tavily-boost-merged"] = merged_tavily
                    print_chords(
                        merged_tavily,
                        "Tavily-Boosted + Autochord Timing (merged)",
                    )
        else:
            print("  Skipping: no Tavily content available")
            if not tavily_key:
                print("  Hint: set TAVILY_API_KEY or pass --tavily-key")

    # ── Compare all ──────────────────────────────────────────
    compare_all(results)

    # ── Print metadata from best Gemini result ───────────────
    best = (
        full_results.get("tavily-boost")
        or full_results.get("hybrid-gemini-raw")
        or full_results.get("gemini-only")
    )
    if best:
        print(f"\n{'=' * 60}")
        print("  SONG METADATA (from Gemini)")
        print(f"{'=' * 60}")
        print(f"  Key:            {best.get('key', '?')}")
        print(f"  Capo:           {best.get('capo', 0)}")
        print(f"  BPM:            {best.get('bpm', '?')}")
        print(f"  Time Signature: {best.get('time_signature', '?')}")
        print(f"  Tuning:         {best.get('tuning', '?')}")
        if best.get("notes"):
            print(f"  Notes:          {best['notes'][:200]}")

    # ── Save output ──────────────────────────────────────────
    output = {
        "song": {"artist": artist, "title": title},
        "results": {
            label: chords for label, chords in results.items()
        },
        "metadata": {
            label: {
                k: v for k, v in data.items()
                if k != "chords" and not k.startswith("_")
            }
            for label, data in full_results.items()
        },
    }

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {out_path.resolve()}")
    else:
        # Save to /tmp by default
        safe_name = f"{artist}_{title}".replace(" ", "_").replace("/", "_")
        out_path = Path(f"/tmp/gemini_hybrid_{safe_name}.json")
        with open(out_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
