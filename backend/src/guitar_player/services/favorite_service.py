"""Favorite service -- manages user song favorites."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.favorite_dao import FavoriteDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.exceptions import AlreadyExistsError, NotFoundError
from guitar_player.schemas.favorite import FavoriteResponse
from guitar_player.storage import StorageBackend


class FavoriteService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self._session = session
        self._storage = storage
        self._favorite_dao = FavoriteDAO(session)
        self._song_dao = SongDAO(session)
        self._user_dao = UserDAO(session)

    async def add_favorite(
        self, user_sub: str, user_email: str, song_id: uuid.UUID
    ) -> FavoriteResponse:
        user = await self._user_dao.get_or_create(user_sub, user_email)

        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        existing = await self._favorite_dao.get_by_user_and_song(user.id, song_id)
        if existing:
            raise AlreadyExistsError("Favorite", f"{user.id}:{song_id}")

        favorite = await self._favorite_dao.create(user_id=user.id, song_id=song_id)
        await self._song_dao.increment_like_count(song_id)
        return self._enrich(FavoriteResponse.model_validate(favorite))

    async def remove_favorite(
        self, user_sub: str, user_email: str, song_id: uuid.UUID
    ) -> None:
        user = await self._user_dao.get_or_create(user_sub, user_email)

        favorite = await self._favorite_dao.get_by_user_and_song(user.id, song_id)
        if not favorite:
            raise NotFoundError("Favorite", f"{user.id}:{song_id}")

        await self._favorite_dao.delete(favorite)
        await self._song_dao.decrement_like_count(song_id)

    async def list_favorites(
        self, user_sub: str, offset: int = 0, limit: int = 50
    ) -> list[FavoriteResponse]:
        user = await self._user_dao.get_by_cognito_sub(user_sub)
        if not user:
            return []

        favorites = await self._favorite_dao.list_by_user(user.id, offset, limit)
        return [self._enrich(FavoriteResponse.model_validate(f)) for f in favorites]

    def _enrich(self, resp: FavoriteResponse) -> FavoriteResponse:
        """Resolve thumbnail_key into a presigned thumbnail_url on the nested song."""
        if resp.song and resp.song.thumbnail_key:
            resp.song.thumbnail_url = self._storage.get_url(resp.song.thumbnail_key)
        return resp
