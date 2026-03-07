"""Admin service — lists candidates that need repair.

Healing execution (fixing keys / triggering jobs) is handled by existing
SongService + JobService; this service focuses on determining which songs
*appear* to require admin healing.
"""

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.models.song import Song
from guitar_player.schemas.admin import (
    AdminRequiredSong,
    AdminRequiredSongsResponse,
)
from guitar_player.storage import StorageBackend


_MISSING_CHECK_COLUMNS: tuple[str, ...] = (
    "audio_key",
    "thumbnail_key",
    "vocals_key",
    "guitar_key",
    "guitar_removed_key",
    "chords_key",
    "lyrics_key",
    "lyrics_quick_key",
    "tabs_key",
)


def _reasons_for_song(song: Song, *, storage: StorageBackend | None) -> list[str]:
    reasons: list[str] = []

    for col in _MISSING_CHECK_COLUMNS:
        key = getattr(song, col, None)

        if not key:
            reasons.append(f"missing:{col}")
            continue

        if storage is not None and not storage.file_exists(key):
            reasons.append(f"missing_file:{col}")

    return reasons


class AdminService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self._session = session
        self._storage = storage

    async def list_required_songs(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        check_storage: bool = True,
        max_scan: int | None = None,
    ) -> AdminRequiredSongsResponse:
        """Return songs that appear to require admin healing.

        Notes:
        - When check_storage is False, we only consider NULL/empty keys.
        - When check_storage is True, we also verify file existence in storage.
        - Because "broken key" detection requires per-row storage checks,
          this endpoint may scan more than `limit` songs to find `limit` matches.
        """

        if max_scan is None:
            max_scan = max(500, limit * 20)

        items: list[AdminRequiredSong] = []
        scanned = 0
        current_offset = offset

        # If we're not checking storage, we can cheaply filter in SQL.
        where_missing_key = None
        if not check_storage:
            where_missing_key = or_(
                *(getattr(Song, col).is_(None) for col in _MISSING_CHECK_COLUMNS)
            )

        while scanned < max_scan and len(items) < limit:
            batch_size = min(200, max_scan - scanned)

            stmt = (
                select(Song)
                .order_by(Song.created_at.desc())
                .offset(current_offset)
                .limit(batch_size)
            )
            if where_missing_key is not None:
                stmt = stmt.where(where_missing_key)

            result = await self._session.execute(stmt)
            songs = list(result.scalars().all())
            if not songs:
                # Exhausted.
                return AdminRequiredSongsResponse(
                    items=items,
                    scanned=scanned,
                    next_offset=None,
                )

            songs_iterated = 0
            for song in songs:
                songs_iterated += 1
                scanned += 1
                reasons = _reasons_for_song(
                    song, storage=self._storage if check_storage else None
                )
                if reasons:
                    items.append(
                        AdminRequiredSong(
                            song_id=song.id,
                            song_name=song.song_name,
                            reasons=reasons,
                        )
                    )
                    if len(items) >= limit:
                        break

            current_offset += songs_iterated

        return AdminRequiredSongsResponse(
            items=items,
            scanned=scanned,
            next_offset=current_offset,
        )
