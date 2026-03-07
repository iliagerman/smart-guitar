"""Pydantic request/response models and shared data types for the API."""

from dataclasses import dataclass

from pydantic import BaseModel, Field


@dataclass
class ChordResult:
    start_time: float
    end_time: float
    chord: str


class RecognizeRequest(BaseModel):
    input_path: str = Field(..., min_length=1, description="Local file path (local) or S3 key (prod)")


class ChordInfo(BaseModel):
    start_time: float
    end_time: float
    chord: str


class RecognizeResponse(BaseModel):
    status: str = "done"
    output_path: str
    chords: list[ChordInfo]
    input_path: str


class ErrorResponse(BaseModel):
    status: str = "error"
    detail: str
