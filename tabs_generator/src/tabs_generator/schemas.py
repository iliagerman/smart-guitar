"""Pydantic request/response models and shared data types for the API."""

from dataclasses import dataclass, field

from pydantic import BaseModel, Field


@dataclass
class NoteResult:
    start_time: float
    end_time: float
    midi_pitch: int
    amplitude: float
    string: int  # 0-indexed from low E
    fret: int
    confidence: float


class TranscribeTabsRequest(BaseModel):
    input_path: str = Field(
        ..., min_length=1, description="Local file path (local) or S3 key (prod)"
    )


class TabNote(BaseModel):
    start_time: float
    end_time: float
    string: int
    fret: int
    midi_pitch: int
    confidence: float


class RhythmInfo(BaseModel):
    bpm: float
    beat_times: list[float]


class TranscribeTabsResponse(BaseModel):
    status: str = "done"
    output_path: str
    tuning: list[str]  # ["E2", "A2", "D3", "G3", "B3", "E4"]
    notes: list[TabNote]
    rhythm: RhythmInfo | None = None
    input_path: str
