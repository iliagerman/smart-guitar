"""Song request/response schemas."""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel

from guitar_player.schemas.job import ActiveJobInfo


class SearchRequest(BaseModel):
    query: str


class SearchResult(BaseModel):
    youtube_id: str
    title: str
    artist: Optional[str] = None
    duration_seconds: Optional[int] = None
    thumbnail_url: Optional[str] = None


class SearchResponse(BaseModel):
    results: list[SearchResult]


class DownloadRequest(BaseModel):
    youtube_id: str


class SongResponse(BaseModel):
    id: uuid.UUID
    youtube_id: Optional[str] = None
    title: str
    artist: Optional[str] = None
    duration_seconds: Optional[int] = None
    song_name: str
    thumbnail_key: Optional[str] = None
    thumbnail_url: Optional[str] = None
    audio_key: Optional[str] = None
    genre: Optional[str] = None
    play_count: int = 0
    like_count: int = 0
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class StemType(BaseModel):
    name: str
    label: str


class StemUrls(BaseModel):
    vocals: Optional[str] = None
    drums: Optional[str] = None
    bass: Optional[str] = None
    guitar: Optional[str] = None
    piano: Optional[str] = None
    other: Optional[str] = None
    guitar_removed: Optional[str] = None
    vocals_guitar: Optional[str] = None


class ChordEntry(BaseModel):
    start_time: float
    end_time: float
    chord: str


class ChordOption(BaseModel):
    name: str
    description: str
    capo: int = 0
    chords: list[ChordEntry] = []


class LyricsWord(BaseModel):
    word: str
    start: float
    end: float


class LyricsSegment(BaseModel):
    start: float
    end: float
    text: str
    words: list[LyricsWord]


class TabNote(BaseModel):
    start_time: float
    end_time: float
    string: int
    fret: int
    midi_pitch: int
    confidence: float


class StrumEvent(BaseModel):
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


class SongSection(BaseModel):
    name: str
    start_time: float
    end_time: float
    strum_pattern: list[str] = []  # e.g. ["down", "down", "up", "down", "up"]
    songsterr_pattern: Optional[list[str]] = None
    llm_pattern: Optional[list[str]] = None
    llm_generated: bool = False


class SongDetailResponse(BaseModel):
    song: SongResponse
    thumbnail_url: Optional[str] = None
    audio_url: Optional[str] = None
    stems: StemUrls = StemUrls()
    stem_types: list[StemType] = []
    chords: list[ChordEntry] = []
    chord_options: list[ChordOption] = []
    lyrics: list[LyricsSegment] = []
    lyrics_source: Optional[str] = None
    quick_lyrics: list[LyricsSegment] = []
    quick_lyrics_source: Optional[str] = None
    corrected_lyrics: list[LyricsSegment] = []
    corrected_lyrics_source: Optional[str] = None
    ver1_lyrics: list[LyricsSegment] = []
    ver1_lyrics_source: Optional[str] = None
    ver2_lyrics: list[LyricsSegment] = []
    ver2_lyrics_source: Optional[str] = None
    ver3_lyrics: list[LyricsSegment] = []
    ver3_lyrics_source: Optional[str] = None
    ver4_lyrics: list[LyricsSegment] = []
    ver4_lyrics_source: Optional[str] = None
    tabs: list[TabNote] = []
    tabs_source: Optional[str] = None  # "songsterr" | "detected"
    strums: list[StrumEvent] = []
    rhythm: Optional[RhythmInfo] = None
    sections: list[SongSection] = []
    source_bpm: Optional[float] = None
    time_signature: Optional[list[int]] = None  # e.g. [3, 4] for 3/4 time
    strum_notes: Optional[str] = None  # Playing instructions from Tavily+LLM
    tutorial_url: Optional[str] = None  # YouTube tutorial link (best match)
    tutorial_links: list[dict] = []  # All tutorial links [{"url": str, "title": str}]
    songsterr_status: Optional[str] = None  # null=pending, "ready", "failed", "unavailable"
    chord_source: Optional[str] = None  # "gemini" | "autochord"
    recommended_capo: Optional[int] = None  # from chord_meta.json
    song_key: Optional[str] = None  # e.g. "Em", "G"
    web_chords_failed: bool = False
    active_job: Optional[ActiveJobInfo] = None
    download_pending: bool = False


class EnrichedSearchResult(BaseModel):
    """Search result enriched with LLM-parsed names and local availability."""

    artist: str
    song: str
    genre: str = "other"
    youtube_id: str
    title: str
    link: str
    thumbnail_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    view_count: Optional[int] = None
    exists_locally: bool = False
    song_id: Optional[uuid.UUID] = None


class EnrichedSearchResponse(BaseModel):
    results: list[EnrichedSearchResult]


class SelectSongRequest(BaseModel):
    song_name: str
    youtube_id: Optional[str] = None


class PaginatedSongsResponse(BaseModel):
    items: list[SongResponse]
    total: int
    offset: int
    limit: int


class GenreCount(BaseModel):
    genre: str
    count: int


class GenreListResponse(BaseModel):
    genres: list[GenreCount]


class FeedbackRating(str, Enum):
    thumbs_up = "thumbs_up"
    thumbs_down = "thumbs_down"


class SongFeedbackRequest(BaseModel):
    rating: FeedbackRating
    comment: Optional[str] = None
