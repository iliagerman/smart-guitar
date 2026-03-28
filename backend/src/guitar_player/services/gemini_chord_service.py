"""Chord detection via Gemini 2.5 Pro audio analysis.

Sends an audio file to Gemini and asks it to identify every chord change
with timestamps, plus metadata (capo, key, BPM, tuning, playing notes).
"""

import asyncio
import json
import logging
import time

from pydantic import BaseModel

logger = logging.getLogger(__name__)

_MAX_RETRIES = 2
_UPLOAD_POLL_INTERVAL = 2.0


class GeminiChordEntry(BaseModel):
    start_time: float
    end_time: float
    chord: str


class GeminiChordResult(BaseModel):
    chords: list[GeminiChordEntry] = []
    key: str = ""
    capo: int = 0
    tuning: str = "Standard"
    bpm: int = 0
    time_signature: str = "4/4"
    notes: str = ""


_CHORD_DETECTION_PROMPT = """\
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
- Include chord quality (major, minor, 7th, sus4, dim, aug, etc.)
- Timestamps must be in seconds with at least 1 decimal place precision.
- Every moment of the song must be covered — no gaps between end_time and \
the next start_time.
- If no chord is playing (silence/percussion only), use "N" as the chord.
- Do NOT merge consecutive identical chords into one entry. Even if the same \
chord repeats across multiple bars, list each bar or phrase as a separate entry. \
This is critical — each chord entry should cover roughly 1-4 bars (2-8 seconds), \
NEVER longer than 15 seconds. If a chord sustains for longer, repeat it as \
separate entries.
- Include intro, outro, and instrumental sections.
- If the song commonly uses a capo, specify the capo fret and list chords \
as the SHAPES played (not sounding pitch).
- Be very precise about WHEN chords change — listen for actual harmonic \
shifts in the audio, not just bar lines. Chord durations will vary.
- IMPORTANT: The song may have repeating chord patterns (e.g. Em C G D). \
Make sure EVERY verse, chorus, and section has the full chord progression \
listed — do not skip sections or leave gaps. The output must cover the \
ENTIRE song from start to finish with consistent granularity.
"""


def _parse_gemini_response(text: str) -> GeminiChordResult | None:
    """Parse JSON from Gemini response, handling markdown fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        text = "\n".join(lines)
    try:
        data = json.loads(text)
        return GeminiChordResult.model_validate(data)
    except (json.JSONDecodeError, Exception) as exc:
        logger.warning("Failed to parse Gemini chord response: %s", exc)
        return None


def _build_prompt(tutorial_context: str | None = None) -> str:
    """Build the Gemini prompt, optionally including Tavily tutorial content."""
    prompt = _CHORD_DETECTION_PROMPT
    if tutorial_context:
        prompt += (
            "\n\n**Reference information from guitar tutorials found online:**\n"
            "Use this to VERIFY and improve your chord detection. The chord names "
            "and capo information here are likely correct — cross-reference with "
            "what you hear in the audio.\n\n"
            f"{tutorial_context[:6000]}"
        )
    return prompt


def _detect_chords_sync(
    audio_path: str,
    api_key: str,
    tutorial_context: str | None = None,
) -> GeminiChordResult | None:
    """Synchronous Gemini chord detection call."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    logger.info("Uploading audio to Gemini: %s", audio_path)
    uploaded = client.files.upload(file=audio_path)

    while uploaded.state.name == "PROCESSING":
        time.sleep(_UPLOAD_POLL_INTERVAL)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name == "FAILED":
        logger.error("Gemini file processing failed for %s", audio_path)
        return None

    start = time.monotonic()
    prompt = _build_prompt(tutorial_context)
    logger.info(
        "Sending to Gemini 2.5 Pro for chord detection (tutorial_context=%s)...",
        bool(tutorial_context),
    )

    for attempt in range(_MAX_RETRIES + 1):
        try:
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

            result = _parse_gemini_response(response.text)
            if result and result.chords:
                elapsed = time.monotonic() - start
                logger.info(
                    "Gemini chord detection: %d chords, key=%s, capo=%d, bpm=%d (%.1fs)",
                    len(result.chords), result.key, result.capo, result.bpm, elapsed,
                )
                return result

            logger.warning("Gemini returned empty/unparseable result (attempt %d)", attempt)

        except Exception as exc:
            logger.warning("Gemini chord detection failed (attempt %d): %s", attempt, exc)

    # Clean up uploaded file
    try:
        client.files.delete(name=uploaded.name)
    except Exception:
        pass

    return None


async def detect_chords(
    audio_path: str,
    api_key: str,
    tutorial_context: str | None = None,
) -> GeminiChordResult | None:
    """Detect chords from an audio file using Gemini 2.5 Pro.

    Returns a GeminiChordResult with chord entries, key, capo, BPM, etc.
    Returns None if detection fails after retries.
    """
    return await asyncio.to_thread(
        _detect_chords_sync, audio_path, api_key, tutorial_context,
    )
