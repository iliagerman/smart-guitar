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
    strum_id: int | None = None  # links to StrumEvent.id, None for single notes


@dataclass
class StrumEvent:
    id: int
    start_time: float  # earliest note onset in the group
    end_time: float  # latest note end_time in the group
    direction: str  # "down", "up", or "ambiguous"
    confidence: float  # 0.0 - 1.0
    num_strings: int  # how many strings are involved
    onset_spread_ms: float  # time spread of onsets in milliseconds


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
    strum_id: int | None = None


class StrumEventResponse(BaseModel):
    id: int
    start_time: float
    end_time: float
    direction: str
    confidence: float
    num_strings: int
    onset_spread_ms: float


class RhythmInfo(BaseModel):
    bpm: float
    beat_times: list[float]


class TranscribeTabsResponse(BaseModel):
    status: str = "done"
    output_path: str
    tuning: list[str]  # ["E2", "A2", "D3", "G3", "B3", "E4"]
    notes: list[TabNote]
    strums: list[StrumEventResponse] = []
    rhythm: RhythmInfo | None = None
    input_path: str
