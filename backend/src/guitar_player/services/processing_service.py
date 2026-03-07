"""Processing service — HTTP client for demucs stem separation and chord recognition."""

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

from guitar_player.config import Settings
from guitar_player.request_context import request_id_var, user_id_var

logger = logging.getLogger(__name__)

PROCESSING_TIMEOUT = 600.0  # seconds — stem separation can take several minutes


@dataclass
class StemInfo:
    name: str
    path: str


@dataclass
class SeparationResult:
    stems: list[StemInfo]
    output_path: str


@dataclass
class ChordInfo:
    start_time: float
    end_time: float
    chord: str


@dataclass
class ChordRecognitionResult:
    chords: list[ChordInfo]
    output_path: str


@dataclass
class WordTimestamp:
    word: str
    start: float
    end: float


@dataclass
class LyricsSegment:
    start: float
    end: float
    text: str
    words: list[WordTimestamp]


@dataclass
class LyricsResult:
    segments: list[LyricsSegment]
    output_path: str
    source: str = "whisper"


class ProcessingService:
    def __init__(self, settings: Settings) -> None:
        self._demucs_host = settings.services.inference_demucs
        self._chords_host = settings.services.chords_generator
        self._lyrics_host = settings.services.lyrics_generator


    async def _request(self, url: str, payload: dict) -> dict:
        """POST to a downstream service with timing, status, and error logging."""
        t0 = time.monotonic()
        logger.info(
            "HTTP request: POST %s",
            url,
            extra={"event_type": "http_request", "http_url": url},
        )
        # Propagate correlation ID to downstream services.
        headers: dict[str, str] = {}
        rid = request_id_var.get()
        if rid:
            headers["X-Request-ID"] = rid
        uid = user_id_var.get()
        if uid:
            headers["X-User-ID"] = uid
        try:
            async with httpx.AsyncClient(timeout=PROCESSING_TIMEOUT) as client:
                resp = await client.post(url, json=payload, headers=headers)
                elapsed_ms = (time.monotonic() - t0) * 1000
                logger.info(
                    "HTTP response: POST %s -> %d (%.0fms)",
                    url,
                    resp.status_code,
                    elapsed_ms,
                    extra={
                        "event_type": "http_response",
                        "http_url": url,
                        "http_status": resp.status_code,
                        "elapsed_ms": round(elapsed_ms, 1),
                    },
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError:
            # Already logged the response above (including the error status code).
            raise
        except Exception as e:
            elapsed_ms = (time.monotonic() - t0) * 1000
            logger.error(
                "HTTP failed: POST %s (%.0fms): %s",
                url,
                elapsed_ms,
                e,
                extra={
                    "event_type": "http_error",
                    "http_url": url,
                    "elapsed_ms": round(elapsed_ms, 1),
                    "error": str(e),
                },
            )
            raise

    async def separate_stems(
        self, input_path: str, requested_outputs: list[str] | None = None
    ) -> SeparationResult:
        """POST to demucs /separate endpoint."""
        url = f"{self._demucs_host}/separate"
        payload: dict = {"input_path": input_path}
        if requested_outputs:
            payload["requested_outputs"] = requested_outputs

        data = await self._request(url, payload)

        stems = [StemInfo(**s) for s in data.get("stems", [])]
        return SeparationResult(
            stems=stems,
            output_path=data.get("output_path", ""),
        )

    async def recognize_chords(self, input_path: str) -> ChordRecognitionResult:
        """POST to chords /recognize endpoint."""
        url = f"{self._chords_host}/recognize"
        data = await self._request(url, {"input_path": input_path})

        chords = [ChordInfo(**c) for c in data.get("chords", [])]
        return ChordRecognitionResult(
            chords=chords,
            output_path=data.get("output_path", ""),
        )

    async def transcribe_lyrics(
        self,
        input_path: str,
        *,
        title: str | None = None,
        artist: str | None = None,
        prompt: str | None = None,
        language: str | None = None,
        openai_api_key: str | None = None,
        openai_model: str | None = None,
        fast_only: bool = False,
    ) -> LyricsResult:
        """Fetch lyrics from LRCLIB + align, falling back to Whisper.

        Uses /fetch-and-align when title and artist are available (enables
        LRCLIB lookup).  Falls back to /transcribe when metadata is missing.

        When *fast_only* is True, only quick lyrics (onset-aligned) are produced;
        Whisper transcription is skipped entirely.
        """
        # /fetch-and-align requires title + artist for LRCLIB lookup
        if title and artist:
            url = f"{self._lyrics_host}/fetch-and-align"
        else:
            url = f"{self._lyrics_host}/transcribe"

        payload: dict = {"input_path": input_path}
        if title:
            payload["title"] = title
        if artist:
            payload["artist"] = artist
        if prompt:
            payload["prompt"] = prompt
        if language:
            payload["language"] = language
        if openai_api_key:
            payload["openai_api_key"] = openai_api_key
        if openai_model:
            payload["openai_model"] = openai_model
        if fast_only:
            payload["fast_only"] = True

        data = await self._request(url, payload)

        segments = []
        for seg in data.get("segments", []):
            words = [WordTimestamp(**w) for w in seg.get("words", [])]
            segments.append(
                LyricsSegment(
                    start=seg["start"],
                    end=seg["end"],
                    text=seg["text"],
                    words=words,
                )
            )
        return LyricsResult(
            segments=segments,
            output_path=data.get("output_path", ""),
            source=data.get("source", "whisper"),
        )

    async def process_song(
        self, input_path: str, requested_outputs: list[str] | None = None
    ) -> dict:
        """Run stem separation and chord recognition in parallel."""
        separation, chords = await asyncio.gather(
            self.separate_stems(input_path, requested_outputs=requested_outputs),
            self.recognize_chords(input_path),
        )

        return {
            "stems": separation.stems,
            "output_path": separation.output_path,
            "chords": chords.chords,
            "chords_output_path": chords.output_path,
        }
