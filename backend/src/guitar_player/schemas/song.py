"""Song request/response schemas."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel

from guitar_player.schemas.job import ActiveJobInfo


class SearchRequest(BaseModel):
    query: str


class SearchResult(BaseModel):
    youtube_id: str
    title: str
    artist: str | None = None
    duration_seconds: int | None = None
    thumbnail_url: str | None = None


class SearchResponse(BaseModel):
    results: list[SearchResult]


class DownloadRequest(BaseModel):
    youtube_id: str


class SongResponse(BaseModel):
    id: uuid.UUID
    youtube_id: str | None = None
    title: str
    artist: str | None = None
    duration_seconds: int | None = None
    song_name: str
    thumbnail_key: str | None = None
    thumbnail_url: str | None = None
    audio_key: str | None = None
    genre: str | None = None
    play_count: int = 0
    like_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class RecommendationsResponse(BaseModel):
    items: list[SongResponse]
    seed_song_id: uuid.UUID


class StemType(BaseModel):
    name: str
    label: str


class StemUrls(BaseModel):
    vocals: str | None = None
    drums: str | None = None
    bass: str | None = None
    guitar: str | None = None
    piano: str | None = None
    other: str | None = None
    guitar_removed: str | None = None
    vocals_guitar: str | None = None


class ChordEntry(BaseModel):
    start_time: float
    end_time: float
    chord: str


class ChordOption(BaseModel):
    name: str
    description: str
    capo: int = 0
    chords: list[ChordEntry] = []
    lyrics: list["LyricsSegment"] | None = None
    lyrics_source: str | None = None
    version_key: str | None = None
    created_by: str | None = None
    vote_score: int = 0
    hidden: bool = False
    is_variant: bool = False


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
    songsterr_pattern: list[str] | None = None
    llm_pattern: list[str] | None = None
    llm_generated: bool = False


class StaticChordPosition(BaseModel):
    chord: str
    position: int


class StaticChordLine(BaseModel):
    type: str  # "lyric" | "section" | "instrumental" | "empty"
    text: str
    chords: list[StaticChordPosition] = []


class SongDetailResponse(BaseModel):
    song: SongResponse
    thumbnail_url: str | None = None
    audio_url: str | None = None
    stems: StemUrls = StemUrls()
    stem_types: list[StemType] = []
    chords: list[ChordEntry] = []
    chord_options: list[ChordOption] = []
    lyrics: list[LyricsSegment] = []
    lyrics_source: str | None = None
    quick_lyrics: list[LyricsSegment] = []
    quick_lyrics_source: str | None = None
    corrected_lyrics: list[LyricsSegment] = []
    corrected_lyrics_source: str | None = None
    ver1_lyrics: list[LyricsSegment] = []
    ver1_lyrics_source: str | None = None
    ver2_lyrics: list[LyricsSegment] = []
    ver2_lyrics_source: str | None = None
    ver3_lyrics: list[LyricsSegment] = []
    ver3_lyrics_source: str | None = None
    ver4_lyrics: list[LyricsSegment] = []
    ver4_lyrics_source: str | None = None
    tabs: list[TabNote] = []
    tabs_source: str | None = None  # "songsterr" | "detected"
    strums: list[StrumEvent] = []
    rhythm: RhythmInfo | None = None
    sections: list[SongSection] = []
    source_bpm: float | None = None
    time_signature: list[int] | None = None  # e.g. [3, 4] for 3/4 time
    strum_notes: str | None = None  # Playing instructions from Tavily+LLM
    tutorial_url: str | None = None  # YouTube tutorial link (best match)
    tutorial_links: list[dict] = []  # All tutorial links [{"url": str, "title": str}]
    songsterr_status: str | None = None  # null=pending, "ready", "failed", "unavailable"
    chord_source: str | None = None  # "gemini" | "autochord" | "hybrid"
    recommended_capo: int | None = None  # from chord_meta.json
    song_key: str | None = None  # e.g. "Em", "G"
    web_chords_failed: bool = False
    web_chords_pending: bool = False
    static_chords: list[StaticChordLine] = []
    static_chords_source: str | None = None
    static_chords_pending: bool = False
    active_job: ActiveJobInfo | None = None
    download_pending: bool = False


class PlaybackSourceResponse(BaseModel):
    url: str


class EnrichedSearchResult(BaseModel):
    """Search result enriched with LLM-parsed names and local availability."""

    artist: str
    song: str
    genre: str = "other"
    youtube_id: str
    title: str
    link: str
    thumbnail_url: str | None = None
    duration_seconds: int | None = None
    view_count: int | None = None
    exists_locally: bool = False
    song_id: uuid.UUID | None = None


class EnrichedSearchResponse(BaseModel):
    results: list[EnrichedSearchResult]


class SelectSongRequest(BaseModel):
    song_name: str
    youtube_id: str | None = None


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


class FeedbackRating(StrEnum):
    thumbs_up = "thumbs_up"
    thumbs_down = "thumbs_down"


class SongFeedbackRequest(BaseModel):
    rating: FeedbackRating
    comment: str | None = None


class SaveUserChordsRequest(BaseModel):
    name: str = "Custom"
    description: str = "User-edited chords"
    capo: int = 0
    chords: list[ChordEntry]
    lyrics: list[LyricsSegment] | None = None


class SaveUserChordsResponse(BaseModel):
    detail: SongDetailResponse
    saved: bool = True
    duplicate_of: str | None = None


class ChordVersionVoteRequest(BaseModel):
    version_key: str
    vote: int  # +1 or -1


class ChordVersionVoteResponse(BaseModel):
    version_key: str
    vote_score: int
