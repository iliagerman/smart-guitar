"""Curated setlist schemas."""

from enum import StrEnum

from pydantic import BaseModel

from guitar_player.enums import SongDifficulty


class SuggestedMode(StrEnum):
    PLAY_ALONG = "play_along"
    DRUMS_BASS = "drums_bass"
    LEARN = "learn"


class SetlistKind(StrEnum):
    """A themed setlist, or a chart of the most wanted songs."""

    SETLIST = "setlist"
    CHART = "chart"


class SetlistSummary(BaseModel):
    id: str
    title: str
    description: str
    level: SongDifficulty
    suggested_mode: SuggestedMode
    kind: SetlistKind = SetlistKind.SETLIST
    song_count: int
    cover_urls: list[str] = []


class SetlistListResponse(BaseModel):
    items: list[SetlistSummary]
