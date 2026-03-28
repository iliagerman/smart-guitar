#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "google-genai>=1.0.0",
# ]
# ///
"""Experiment: detect guitar chords from audio using Gemini 2.5 Pro.

Sends an audio file to Gemini and asks it to identify every chord change
with precise timestamps.  Outputs JSON results for comparison against
known chord sheets (ground truth) and autochord output.

Examples:
  uv run scripts/gemini_chord_experiment.py -a path/to/song.mp3
  uv run scripts/gemini_chord_experiment.py -a song.mp3 -o results.json
  uv run scripts/gemini_chord_experiment.py -a song.mp3 --compare autochord.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def _api_key(provided: str | None) -> str | None:
    if provided:
        return provided
    return os.environ.get("GEMINI_API_KEY")


_CHORD_DETECTION_PROMPT = """\
Listen to this audio file carefully.  You are an expert guitarist and music \
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
  "notes": "Any playing tips or observations about the chord voicings"
}

**Rules:**
- Use standard chord notation: C, Am, G7, Dmaj7, F#m, Bb, D6/9, etc.
- Include chord quality (major, minor, 7th, sus4, dim, aug, etc.)
- Timestamps must be in seconds with at least 1 decimal place precision.
- Every moment of the song must be covered — no gaps between end_time and \
the next start_time.
- If no chord is playing (silence/percussion only), use "N" as the chord.
- Merge consecutive identical chords into one entry.
- Include intro, outro, and instrumental sections.
- If the song commonly uses a capo, specify the capo fret and list chords \
as the SHAPES played (not sounding pitch).
- Be precise about when chords actually change — listen for harmonic shifts, \
not just bar lines.
"""


def detect_chords(audio_path: str, api_key: str) -> dict:
    """Send audio to Gemini 2.5 Pro and get chord detection results."""
    from google import genai
    from google.genai import types

    p = Path(audio_path)
    if not p.is_file():
        print(f"Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Uploading {p.name} ({p.stat().st_size / 1024 / 1024:.1f} MB)...")

    client = genai.Client(api_key=api_key)

    # Upload the audio file first (required for large files)
    uploaded = client.files.upload(file=p)
    print(f"Uploaded as: {uploaded.name}")

    # Wait for file to be processed
    while uploaded.state.name == "PROCESSING":
        print("  waiting for file processing...")
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name == "FAILED":
        print(f"File processing failed: {uploaded.state}", file=sys.stderr)
        sys.exit(1)

    print("Sending to Gemini 2.5 Pro for chord detection...")
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
                    types.Part.from_text(text=_CHORD_DETECTION_PROMPT),
                ],
            ),
        ],
        config=types.GenerateContentConfig(
            temperature=0.1,
        ),
    )

    elapsed = time.monotonic() - start
    print(f"Response received in {elapsed:.1f}s")

    # Clean up the uploaded file
    try:
        client.files.delete(name=uploaded.name)
    except Exception:
        pass

    # Parse the JSON response
    text = response.text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json) and last line (```)
        lines = [line for line in lines if not line.strip().startswith("```")]
        text = "\n".join(lines)

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        print("Failed to parse JSON response. Raw output:", file=sys.stderr)
        print(text, file=sys.stderr)
        sys.exit(1)

    result["_meta"] = {
        "model": "gemini-2.5-pro",
        "audio_file": str(p.resolve()),
        "detection_time_seconds": round(elapsed, 1),
    }

    return result


def compare_with_file(gemini_result: dict, compare_path: str) -> None:
    """Compare Gemini results against a reference chord file (autochord JSON)."""
    ref_path = Path(compare_path)
    if not ref_path.is_file():
        print(f"Comparison file not found: {compare_path}", file=sys.stderr)
        return

    with open(ref_path) as f:
        ref_data = json.load(f)

    # Handle both formats: list of chords or dict with "chords" key
    ref_chords = ref_data if isinstance(ref_data, list) else ref_data.get("chords", [])
    gemini_chords = gemini_result.get("chords", [])

    print(f"\n{'=' * 60}")
    print("COMPARISON: Gemini vs Reference")
    print(f"{'=' * 60}")
    print(f"Gemini detected:    {len(gemini_chords)} chord entries")
    print(f"Reference has:      {len(ref_chords)} chord entries")

    # Extract unique chord names
    gemini_unique = sorted({c["chord"] for c in gemini_chords if c["chord"] != "N"})
    ref_unique = sorted({c["chord"] for c in ref_chords if c["chord"] != "N"})
    print(f"Gemini unique:      {', '.join(gemini_unique)}")
    print(f"Reference unique:   {', '.join(ref_unique)}")

    # Time coverage
    if gemini_chords:
        g_end = max(c.get("end_time", 0) for c in gemini_chords)
        print(f"Gemini coverage:    0 - {g_end:.1f}s")
    if ref_chords:
        r_end = max(c.get("end_time", 0) for c in ref_chords)
        print(f"Reference coverage: 0 - {r_end:.1f}s")


def print_summary(result: dict) -> None:
    """Print a human-readable summary of the detection results."""
    chords = result.get("chords", [])
    print(f"\n{'=' * 60}")
    print("GEMINI CHORD DETECTION RESULTS")
    print(f"{'=' * 60}")
    print(f"Key:            {result.get('key', '?')}")
    print(f"Capo:           {result.get('capo', 0)}")
    print(f"Tuning:         {result.get('tuning', '?')}")
    print(f"BPM:            {result.get('bpm', '?')}")
    print(f"Time Signature: {result.get('time_signature', '?')}")
    print(f"Total chords:   {len(chords)}")

    unique = sorted({c["chord"] for c in chords if c["chord"] != "N"})
    print(f"Unique chords:  {', '.join(unique)}")

    if result.get("notes"):
        print(f"Notes:          {result['notes']}")

    meta = result.get("_meta", {})
    if meta:
        print(f"Detection time: {meta.get('detection_time_seconds', '?')}s")

    print(f"\n{'─' * 60}")
    print(f"{'Start':>7}  {'End':>7}  {'Dur':>5}  Chord")
    print(f"{'─' * 60}")
    for c in chords[:50]:  # Show first 50 entries
        start = c.get("start_time", 0)
        end = c.get("end_time", 0)
        dur = end - start
        print(f"{start:7.1f}  {end:7.1f}  {dur:5.1f}  {c['chord']}")

    if len(chords) > 50:
        print(f"  ... ({len(chords) - 50} more entries)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect guitar chords from audio using Gemini 2.5 Pro",
    )
    parser.add_argument("--audio", "-a", required=True, help="Path to audio file (MP3, WAV, etc.)")
    parser.add_argument("--output", "-o", help="Output JSON file path (default: prints to stdout)")
    parser.add_argument("--compare", "-c", help="Compare against reference chord JSON file")
    parser.add_argument("--api-key", "-k", help="Overrides GEMINI_API_KEY env var")
    args = parser.parse_args()

    key = _api_key(args.api_key)
    if not key:
        print("Missing Gemini API key.", file=sys.stderr)
        print("Set GEMINI_API_KEY in your environment.", file=sys.stderr)
        return 1

    result = detect_chords(args.audio, key)

    print_summary(result)

    if args.compare:
        compare_with_file(result, args.compare)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nResults saved to: {out_path.resolve()}")
    else:
        print(f"\n{'=' * 60}")
        print("FULL JSON OUTPUT")
        print(f"{'=' * 60}")
        print(json.dumps(result, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
