"""Pydantic request/response models and shared data types for the API."""

from dataclasses import dataclass

from pydantic import BaseModel, Field


@dataclass
class WordInfo:
    word: str
    start: float
    end: float


@dataclass
class SegmentInfo:
    start: float
    end: float
    text: str
    words: list[WordInfo]


class TranscribeRequest(BaseModel):
    input_path: str = Field(
        ..., min_length=1, description="Local file path (local) or S3 key (prod)"
    )
    # Optional metadata to improve transcription quality via an initial prompt.
    # Kept optional for backward compatibility with older callers.
    title: str | None = Field(default=None, description="Song title")
    artist: str | None = Field(default=None, description="Song artist")
    album: str | None = Field(default=None, description="Album name (optional, improves LRCLIB match)")
    duration: float | None = Field(default=None, description="Track duration in seconds (optional)")
    prompt: str | None = Field(
        default=None,
        description="Optional explicit prompt override (advanced).",
    )
    language: str | None = Field(
        default=None,
        description=(
            "ISO-639-1 language code for Whisper (e.g. 'he', 'ar', 'ja'). "
            "If omitted, auto-detected from title/artist Unicode script, "
            "falling back to Whisper audio auto-detection."
        ),
    )
    openai_api_key: str | None = Field(
        default=None,
        description="OpenAI API key; if provided, used as fallback when local WhisperX fails",
    )
    openai_model: str | None = Field(
        default=None,
        description="OpenAI model name (e.g. 'whisper-1')",
    )


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float


class Segment(BaseModel):
    start: float
    end: float
    text: str
    words: list[WordTimestamp]


class TranscribeResponse(BaseModel):
    status: str = "done"
    output_path: str
    segments: list[Segment]
    input_path: str
    source: str = Field(default="whisper", description="Where lyrics came from: 'lrclib_synced+whisper', 'lrclib_plain+whisper', 'openai_whisper', or 'whisper'")


class FetchAndAlignRequest(BaseModel):
    input_path: str = Field(
        ..., min_length=1, description="Local file path (local) or S3 key (prod) to the vocals audio"
    )
    title: str = Field(..., min_length=1, description="Song title (used for LRCLIB lookup)")
    artist: str = Field(..., min_length=1, description="Artist name (used for LRCLIB lookup)")
    album: str | None = Field(default=None, description="Album name (optional, improves match)")
    duration: float | None = Field(default=None, description="Track duration in seconds (optional)")
    fallback_to_transcription: bool = Field(
        default=True,
        description="If True, fall back to Whisper transcription when no lyrics are found online",
    )
    language: str | None = Field(default=None, description="ISO-639-1 language code for Whisper fallback")
    prompt: str | None = Field(default=None, description="Optional prompt override for Whisper fallback")
    openai_api_key: str | None = Field(
        default=None,
        description="OpenAI API key; used for non-English transcription and as fallback",
    )
    openai_model: str | None = Field(default=None, description="OpenAI model name (e.g. 'whisper-1')")
    fast_only: bool = Field(
        default=False,
        description="If True, only produce lyrics_quick.json via onset alignment (skip Whisper transcription entirely)",
    )


class FetchAndAlignResponse(BaseModel):
    status: str = "done"
    output_path: str
    segments: list[Segment]
    input_path: str
    source: str = Field(description="Where lyrics came from: 'lrclib_synced+whisper', 'lrclib_plain+whisper', 'openai_whisper', or 'whisper'")


class ErrorResponse(BaseModel):
    status: str = "error"
    detail: str
