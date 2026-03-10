"""LLM-based lyrics correction: merge quick lyrics text with Whisper timestamps.

Quick lyrics from LRCLib have correct text and line structure but inaccurate
word-level timestamps.  Whisper produces accurate word timestamps but often
garbles non-English text (especially Hebrew).

This module sends both versions to an LLM (Amazon Nova Lite via Bedrock) which
reasons about which timestamps are reliable, fixes unrealistic durations, and
produces a corrected output with correct text and improved timing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import boto3

from lyrics_generator.schemas import SegmentInfo, WordInfo

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a lyrics timing correction engine. You receive two versions of song lyrics with word-level timestamps:

1. **whisper_segments** — produced by Whisper speech recognition. The timestamps (especially word onsets) are generally accurate, but the TEXT is often garbled for non-English languages (Hebrew, Arabic, etc.). Whisper may transliterate words to English, merge multiple lines into one segment, or produce nonsense text.

2. **quick_segments** — produced from an online lyrics database with onset-detection alignment. The TEXT and line structure are correct, but timestamps may be rough (especially word-level timing within a line).

Your task: produce **corrected_segments** that combine the best of both:

## Rules
1. **Text**: Always use the text from quick_segments. Never use Whisper's text.
2. **Line structure**: Keep the same number of segments and same text per segment as quick_segments.
3. **Segment timing**: Use Whisper onset times for segment starts when you can identify the corresponding Whisper segment (by time overlap, not text). For segment ends, use the start of the next segment or the Whisper segment end.
4. **Word timing**:
   - If a quick segment overlaps in time with Whisper segments that have a similar word count, transfer Whisper's word-level timestamps onto the quick words (in order).
   - If word counts differ, distribute words proportionally across the segment duration, using any Whisper word onsets as anchors where they seem reliable.
   - Fix unrealistically short word durations (< 0.1s for multi-syllable words) by redistributing time from neighboring words.
5. **Chorus/repeated sections**: If Whisper has English transliterations or nonsense for a section, use the quick_segments timestamps for that section (they're usually decent for repeated parts).
6. **Monotonicity**: Ensure all timestamps are monotonically increasing. No word should start before the previous word ends.

## Output format
Return a JSON object with a single key "segments" containing an array. Each segment has:
- "start": float (seconds)
- "end": float (seconds)
- "text": string (the full line text from quick_segments)
- "words": array of {"word": string, "start": float, "end": float}

Round all timestamps to 3 decimal places. Return ONLY valid JSON, no markdown fences or explanation."""

DEFAULT_MODEL_ID = "us.amazon.nova-2-lite-v1:0"


def _create_bedrock_client(settings):
    """Create a bedrock-runtime boto3 client using application settings."""
    kwargs: dict = {"region_name": settings.aws.region}
    if not settings.aws.use_iam_role:
        kwargs["aws_access_key_id"] = settings.aws.access_key
        kwargs["aws_secret_access_key"] = settings.aws.secret_key
    return boto3.client("bedrock-runtime", **kwargs)


def _converse_sync(
    client,
    model_id: str,
    whisper_json: list[dict],
    quick_json: list[dict],
) -> dict:
    """Call Bedrock converse API and return parsed JSON response."""
    user_message = json.dumps({
        "whisper_segments": whisper_json,
        "quick_segments": quick_json,
    }, ensure_ascii=False)

    response = client.converse(
        modelId=model_id,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[
            {"role": "user", "content": [{"text": user_message}]},
        ],
    )

    raw_text = response["output"]["message"]["content"][0]["text"]

    # Try to extract JSON from the response (may be wrapped in markdown fences)
    json_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if not json_match:
        raise ValueError(f"No JSON found in LLM response: {raw_text[:200]}")

    return json.loads(json_match.group())


async def correct_lyrics_llm(
    whisper_segments: list[SegmentInfo],
    quick_segments: list[SegmentInfo],
    *,
    settings=None,
    model_id: str = DEFAULT_MODEL_ID,
) -> list[SegmentInfo]:
    """Build corrected lyrics using Bedrock Nova Lite to merge timestamps.

    Args:
        whisper_segments: Segments from Whisper (accurate timestamps, wrong text).
        quick_segments: Segments from LRCLib (correct text+structure, rough timestamps).
        settings: Application settings (for AWS credentials). Auto-loaded if None.
        model_id: Bedrock model ID.

    Returns:
        Corrected segments with quick-lyrics text and improved timestamps.
    """
    if not quick_segments:
        return whisper_segments

    whisper_json = _segments_to_json(whisper_segments)
    quick_json = _segments_to_json(quick_segments)

    try:
        client = _create_bedrock_client(settings)

        result = await asyncio.to_thread(
            _converse_sync, client, model_id, whisper_json, quick_json,
        )

        corrected = _parse_llm_response(result, quick_segments)

        logger.info(
            "LLM lyrics correction: %d quick segments → %d corrected segments",
            len(quick_segments),
            len(corrected),
        )
        return corrected

    except Exception as e:
        logger.warning("LLM lyrics correction failed: %s", e, exc_info=True)
        return quick_segments


def _segments_to_json(segments: list[SegmentInfo]) -> list[dict[str, Any]]:
    """Convert SegmentInfo list to JSON-serializable dicts."""
    return [
        {
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": s.text,
            "words": [
                {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
                for w in (s.words or [])
            ],
        }
        for s in segments
    ]


def _parse_llm_response(
    data: dict[str, Any],
    quick_segments: list[SegmentInfo],
) -> list[SegmentInfo]:
    """Parse LLM JSON response into SegmentInfo list.

    Falls back to quick_segments if parsing fails for any segment.
    """
    raw_segments = data.get("segments", [])
    if not raw_segments:
        logger.warning("LLM response has no segments")
        return quick_segments

    corrected: list[SegmentInfo] = []
    for i, seg in enumerate(raw_segments):
        try:
            words = [
                WordInfo(
                    word=w["word"],
                    start=round(float(w["start"]), 3),
                    end=round(float(w["end"]), 3),
                )
                for w in seg.get("words", [])
            ]
            corrected.append(SegmentInfo(
                start=round(float(seg["start"]), 3),
                end=round(float(seg["end"]), 3),
                text=seg["text"],
                words=words,
            ))
        except (KeyError, ValueError, TypeError) as e:
            logger.warning("Failed to parse LLM segment %d: %s", i, e)
            if i < len(quick_segments):
                corrected.append(quick_segments[i])

    return corrected


# Keep the old function signature as a sync wrapper for backward compat
def correct_lyrics(
    whisper_segments: list[SegmentInfo],
    quick_segments: list[SegmentInfo],
    audio=None,  # ignored — kept for API compat
) -> list[SegmentInfo]:
    """Sync fallback: returns quick_segments with Whisper segment-level timing.

    This is a simple fallback used when the async LLM path isn't available.
    It applies Whisper segment start/end times to quick segments by time overlap,
    but doesn't attempt word-level correction.
    """
    if not quick_segments:
        return whisper_segments
    corrected: list[SegmentInfo] = []
    for qseg in quick_segments:
        best_overlap = 0.0
        best_wseg = None
        for wseg in whisper_segments:
            overlap = max(0.0, min(qseg.end, wseg.end) - max(qseg.start, wseg.start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_wseg = wseg
        if best_wseg and best_overlap > 0:
            corrected.append(SegmentInfo(
                start=best_wseg.start,
                end=best_wseg.end,
                text=qseg.text,
                words=qseg.words,
            ))
        else:
            corrected.append(qseg)
    return corrected
