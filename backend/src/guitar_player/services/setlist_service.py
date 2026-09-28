"""Curated setlists -- code-defined filters over the playable song library."""

from dataclasses import dataclass

from sqlalchemy import ColumnElement, or_
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.song_dao import SongDAO
from guitar_player.enums import SkillLevel, SongDifficulty
from guitar_player.exceptions import NotFoundError
from guitar_player.models.song import Song
from guitar_player.schemas.setlist import SetlistListResponse, SetlistSummary, SuggestedMode
from guitar_player.schemas.song import PaginatedSongsResponse
from guitar_player.services.song_service.helpers import song_response
from guitar_player.storage import StorageBackend

COVERS_PER_SETLIST = 3

_HEBREW_LETTER = "[֐-׿]"
_EASY = SongDifficulty.EASY.value
_MEDIUM = SongDifficulty.MEDIUM.value
_HARD = SongDifficulty.HARD.value


@dataclass(frozen=True)
class SetlistDefinition:
    title: str
    description: str
    level: SongDifficulty
    suggested_mode: SuggestedMode
    filters: tuple[ColumnElement[bool], ...]
    order_by: tuple[ColumnElement, ...] = (Song.play_count.desc(),)
    max_songs: int | None = None


SETLISTS: dict[str, SetlistDefinition] = {
    "campfire": SetlistDefinition(
        title="4-Chord Campfire",
        description="Four easy shapes, whole songs. The fastest way to sound like you can play.",
        level=SongDifficulty.EASY,
        suggested_mode=SuggestedMode.PLAY_ALONG,
        filters=(Song.difficulty == _EASY, Song.chord_count <= 4),
    ),
    "first-songs": SetlistDefinition(
        title="Your First 10 Songs",
        description="Easy shapes and relaxed tempos for your first month on guitar.",
        level=SongDifficulty.EASY,
        suggested_mode=SuggestedMode.LEARN,
        filters=(Song.difficulty == _EASY,),
        order_by=(Song.chord_count.asc(), Song.tempo_bpm.asc().nulls_last()),
        max_songs=10,
    ),
    "slow-pretty": SetlistDefinition(
        title="Slow & Pretty",
        description="Ballads and acoustic favorites that sound great with a simple strum.",
        level=SongDifficulty.EASY,
        suggested_mode=SuggestedMode.PLAY_ALONG,
        filters=(
            Song.genre.in_(["pop", "folk", "acoustic", "soft-rock", "r&b", "country"]),
            Song.tempo_bpm < 100,
            Song.difficulty.in_([_EASY, _MEDIUM]),
        ),
    ),
    "band-room": SetlistDefinition(
        title="Band Room Rock",
        description="Kick the guitarist out of real rock records and take his place.",
        level=SongDifficulty.MEDIUM,
        suggested_mode=SuggestedMode.PLAY_ALONG,
        filters=(
            Song.genre.in_(["rock", "alternative", "punk", "indie", "metal"]),
            Song.difficulty.in_([_EASY, _MEDIUM]),
        ),
    ),
    "jam-drummer": SetlistDefinition(
        title="Jam With The Drummer",
        description="Just drums and bass behind you — you bring the rest.",
        level=SongDifficulty.MEDIUM,
        suggested_mode=SuggestedMode.DRUMS_BASS,
        filters=(
            Song.genre.in_(["rock", "punk", "metal", "alternative", "blues", "reggae"]),
            Song.tempo_bpm >= 110,
        ),
    ),
    "israeli": SetlistDefinition(
        title="Israeli Favorites",
        description="Hebrew songs with chords and lyrics ready to play.",
        level=SongDifficulty.MEDIUM,
        suggested_mode=SuggestedMode.PLAY_ALONG,
        filters=(
            or_(
                Song.title.regexp_match(_HEBREW_LETTER),
                Song.artist.regexp_match(_HEBREW_LETTER),
            ),
        ),
    ),
    "challenge": SetlistDefinition(
        title="Level Up",
        description="More chords, barre shapes and faster changes.",
        level=SongDifficulty.HARD,
        suggested_mode=SuggestedMode.PLAY_ALONG,
        filters=(Song.difficulty == _HARD,),
    ),
}

# Setlist difficulty order that best fits each skill level.
_LEVEL_FIT: dict[SkillLevel, tuple[SongDifficulty, ...]] = {
    SkillLevel.BEGINNER: (SongDifficulty.EASY, SongDifficulty.MEDIUM, SongDifficulty.HARD),
    SkillLevel.INTERMEDIATE: (SongDifficulty.MEDIUM, SongDifficulty.EASY, SongDifficulty.HARD),
    SkillLevel.ADVANCED: (SongDifficulty.HARD, SongDifficulty.MEDIUM, SongDifficulty.EASY),
}


class SetlistService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self._storage = storage
        self._song_dao = SongDAO(session)

    async def list_setlists(self, level: SkillLevel) -> SetlistListResponse:
        """Non-empty setlists, best fit for the skill level first."""
        fit = _LEVEL_FIT[level]
        ranked = sorted(SETLISTS.items(), key=lambda item: fit.index(item[1].level))
        items: list[SetlistSummary] = []
        for setlist_id, setlist in ranked:
            song_count = await self._song_count(setlist)
            if not song_count:
                continue
            covers = await self._song_dao.list_playable(
                [*setlist.filters, Song.thumbnail_key.isnot(None)],
                setlist.order_by, 0, COVERS_PER_SETLIST,
            )
            items.append(SetlistSummary(
                id=setlist_id,
                title=setlist.title,
                description=setlist.description,
                level=setlist.level,
                suggested_mode=setlist.suggested_mode,
                song_count=song_count,
                cover_urls=[self._storage.get_url(song.thumbnail_key) for song in covers],
            ))
        return SetlistListResponse(items=items)

    async def list_songs(self, setlist_id: str, skip: int, limit: int) -> PaginatedSongsResponse:
        setlist = SETLISTS.get(setlist_id)
        if setlist is None:
            raise NotFoundError("Setlist", setlist_id)
        total = await self._song_count(setlist)
        window = min(limit, total - skip)
        songs = (
            await self._song_dao.list_playable(setlist.filters, setlist.order_by, skip, window)
            if window > 0
            else []
        )
        return PaginatedSongsResponse(
            items=[song_response(self._storage, song) for song in songs],
            total=total, offset=skip, limit=limit,
        )

    async def _song_count(self, setlist: SetlistDefinition) -> int:
        count = await self._song_dao.count_playable(setlist.filters)
        return min(count, setlist.max_songs) if setlist.max_songs else count
