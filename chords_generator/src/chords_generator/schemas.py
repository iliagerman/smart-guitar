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
    accompaniment_stem_paths: list[str] = Field(
        default_factory=list,
        description=(
            "Optional non-vocal, non-drum stem paths / S3 keys (e.g. bass, "
            "guitar, piano, other) to mix and recognize instead of the full "
            "mix. Falls back to input_path when empty or no listed stem exists."
        ),
    )


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


class AlignRequest(BaseModel):
    chords_path: str = Field(..., min_length=1, description="chords.json path / S3 key; chord_probs.npz and chord_meta.json sit beside it")
    sheet_path: str = Field(..., min_length=1, description="static_chords.json path / S3 key (community chord sheet versions)")


class AlignResponse(BaseModel):
    status: str = "done"
    accepted: bool
    loss_per_beat: float | None = None
    transpose: int | None = None
    source_url: str | None = None
    chords: list[ChordInfo] = Field(default_factory=list)


class PracticeAudioRequest(BaseModel):
    chords_path: str = Field(..., min_length=1, description="chords.json path / S3 key; chord_meta.json (the beat grid) sits beside it")
    stems: dict[str, str] = Field(..., min_length=1, description="Stem name -> stem path / S3 key, e.g. {'guitar': 'song/guitar.mp3'}")


class PracticeAudioResponse(BaseModel):
    status: str = "done"
    mixer_stems: list[str]  # stem names given a mixer/<name>.mp3 copy
    accents: list[bool] | None = None  # per eighth note of the bar; None when it couldn't be measured


class ErrorResponse(BaseModel):
    status: str = "error"
    detail: str
