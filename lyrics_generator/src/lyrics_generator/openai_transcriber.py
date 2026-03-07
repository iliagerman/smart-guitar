"""OpenAI Whisper API transcription.

Provides an async function that calls the OpenAI audio transcription API
with word-level timestamps, parses the verbose_json response, and writes
the same lyrics.json schema as the local Whisper transcriber.

Used when the caller supplies an OpenAI API key; otherwise the service
falls back to local Whisper.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from .schemas import SegmentInfo, WordInfo

logger = logging.getLogger(__name__)


def _build_prompt(*, title: str | None, artist: str | None) -> str | None:
    t = (title or "").strip()
    a = (artist or "").strip()
    if not (t or a):
        return None
    bits: list[str] = []
    if t:
        bits.append(f"Song: {t}")
    if a:
        bits.append(f"Artist: {a}")
    return "; ".join(bits) if bits else None


def _parse_transcription_response(data: dict) -> list[SegmentInfo]:
    """Parse an OpenAI verbose_json transcription response into SegmentInfo.

    The OpenAI API returns word timestamps at the TOP LEVEL of the response
    (data["words"]), not nested inside each segment.  We parse them first,
    then assign each word to its matching segment by time range.

    Falls back to per-segment words if the API ever nests them.
    """
    all_words: list[WordInfo] = []
    for w in data.get("words", []) or []:
        ww = (w.get("word") or w.get("text") or "").strip()
        if not ww:
            continue
        ws = float(w.get("start", 0.0))
        we = float(w.get("end", ws))
        all_words.append(WordInfo(word=ww, start=ws, end=we))

    segments: list[SegmentInfo] = []
    for seg in data.get("segments", []) or []:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))

        # Assign top-level words that fall within this segment's range.
        seg_words = [w for w in all_words if w.start >= start and w.start < end]

        # Fall back to per-segment words if the API ever nests them.
        if not seg_words:
            for w in seg.get("words") or []:
                ww = (w.get("word") or w.get("text") or "").strip()
                if not ww:
                    continue
                ws = float(w.get("start", start))
                we = float(w.get("end", ws))
                seg_words.append(WordInfo(word=ww, start=ws, end=we))

        segments.append(SegmentInfo(start=start, end=end, text=text, words=seg_words))

    return segments


async def transcribe_openai(
    audio_path: str,
    *,
    api_key: str,
    model: str = "whisper-1",
    language: str | None = "en",
    title: str | None = None,
    artist: str | None = None,
) -> list[SegmentInfo]:
    """Transcribe a local audio file via the OpenAI API.

    Returns a list of SegmentInfo with word-level timestamps.
    Raises on failure so the caller can fall back to local Whisper.
    """
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key, max_retries=0)

    p = Path(audio_path)
    if not p.is_file():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    prompt = _build_prompt(title=title, artist=artist)

    logger.info(
        "OpenAI transcription request: model=%s language=%s prompt=%r audio=%s",
        model,
        language,
        prompt,
        p.name,
    )

    with p.open("rb") as f:
        resp = await client.audio.transcriptions.create(
            model=model,
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
            language=language,
            prompt=prompt,
        )

    data = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
    segments = _parse_transcription_response(data)

    logger.info(
        "OpenAI transcription complete: segments=%s model=%s",
        len(segments),
        model,
    )
    return segments


def write_lyrics_json(
    segments: list[SegmentInfo],
    out_path: str,
    *,
    source: str | None = None,
) -> None:
    """Write segments to lyrics.json in the standard format.

    Args:
        segments: Transcribed segments with word-level timestamps.
        out_path: Destination file path.
        source: Transcription strategy that produced these segments
            (e.g. "whisper", "openai_whisper", "lrclib_synced").
            Persisted in the JSON so the frontend can display it.
    """
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    data: dict = {
        "segments": [
            {
                "start": round(s.start, 3),
                "end": round(s.end, 3),
                "text": s.text,
                "words": [
                    {
                        "word": w.word,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                    }
                    for w in s.words
                ],
            }
            for s in segments
        ],
    }
    if source:
        data["source"] = source
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
