"""Pydantic request/response models and shared data types for the API."""

from dataclasses import dataclass

from pydantic import BaseModel, Field


@dataclass
class ChordResult:
    start_time: float
    end_time: float
    chord: str
    # Slash bass note (e.g. "G" for C/G) when the sounding bass differs from the
    # chord root; None for root-position chords or when undetected.
    bass: str | None = None


class RecognizeRequest(BaseModel):
    input_path: str = Field(..., min_length=1, description="Local file path (local) or S3 key (prod)")


class ChordInfo(BaseModel):
    start_time: float
    end_time: float
    chord: str
    bass: str | None = None


class RecognizeResponse(BaseModel):
    status: str = "done"
    output_path: str
    chords: list[ChordInfo]
    input_path: str


class DetectBassRequest(BaseModel):
    bass_path: str = Field(..., min_length=1, description="Bass stem file path / S3 key")
    chords_path: str = Field(..., min_length=1, description="chords.json path / S3 key to annotate in place")


class DetectBassResponse(BaseModel):
    status: str = "done"
    chords: list[ChordInfo]
    chords_path: str


class EnhanceRequest(BaseModel):
    audio_path: str = Field(..., min_length=1, description="Full-mix audio path / S3 key (for beat detection)")
    chords_path: str = Field(..., min_length=1, description="chords.json path / S3 key to enhance in place")
    bass_path: str = Field("", description="Optional bass stem path / S3 key for slash-bass detection")


class EnhanceResponse(BaseModel):
    status: str = "done"
    chords: list[ChordInfo]
    chords_path: str
    beats_detected: int = 0
    bass_count: int = 0


class ErrorResponse(BaseModel):
    status: str = "error"
    detail: str
