"""Integration tests: favorites feature (add, remove, list, user isolation).

Requires:
- Database (configured via APP_ENV=test)

Does NOT require:
- Network access (YouTube)
- AWS credentials (Bedrock)
"""

import uuid

import pytest

from guitar_player.dao.favorite_dao import FavoriteDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.services.favorite_service import FavoriteService
from guitar_player.exceptions import AlreadyExistsError, NotFoundError

TEST_USER_A_SUB = "test-favorites-user-a"
TEST_USER_A_EMAIL = "user-a@test.com"
TEST_USER_B_SUB = "test-favorites-user-b"
TEST_USER_B_EMAIL = "user-b@test.com"


async def _setup(session):
    """Create test users and songs, return them."""
    user_dao = UserDAO(session)
    song_dao = SongDAO(session)

    user_a = await user_dao.get_or_create(TEST_USER_A_SUB, TEST_USER_A_EMAIL)
    user_b = await user_dao.get_or_create(TEST_USER_B_SUB, TEST_USER_B_EMAIL)

    song_1 = await song_dao.create(
        title="Fav Test Song 1",
        song_name=f"test_artist/fav_test_song_{uuid.uuid4().hex[:8]}",
    )
    song_2 = await song_dao.create(
        title="Fav Test Song 2",
        song_name=f"test_artist/fav_test_song_{uuid.uuid4().hex[:8]}",
    )
    await session.commit()
    return user_a, user_b, song_1, song_2


async def _cleanup_favorites(session, *user_ids):
    """Remove all favorites for the given users."""
    fav_dao = FavoriteDAO(session)
    for uid in user_ids:
        for fav in await fav_dao.list_by_user(uid):
            await fav_dao.delete(fav)
    await session.commit()


# ── Add ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_add_favorite(session_factory):
    """Adding a favorite returns correct user_id and song_id."""
    async with session_factory() as session:
        user_a, _, song_1, _ = await _setup(session)
        svc = FavoriteService(session)

        result = await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        assert result.song_id == song_1.id
        assert result.user_id == user_a.id
        assert result.id is not None

        await _cleanup_favorites(session, user_a.id)


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_add_duplicate_raises(session_factory):
    """Adding the same song twice raises AlreadyExistsError."""
    async with session_factory() as session:
        user_a, _, song_1, _ = await _setup(session)
        svc = FavoriteService(session)

        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await session.commit()

        with pytest.raises(AlreadyExistsError):
            await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)

        await _cleanup_favorites(session, user_a.id)


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_add_nonexistent_song_raises(session_factory):
    """Adding a favorite for a song that doesn't exist raises NotFoundError."""
    async with session_factory() as session:
        await _setup(session)
        svc = FavoriteService(session)

        with pytest.raises(NotFoundError):
            await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, uuid.uuid4())


# ── List ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_list_favorites(session_factory):
    """Listing returns all favorites for the user."""
    async with session_factory() as session:
        user_a, _, song_1, song_2 = await _setup(session)
        svc = FavoriteService(session)

        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_2.id)
        await session.commit()

        favs = await svc.list_favorites(TEST_USER_A_SUB)
        assert len(favs) == 2
        assert {f.song_id for f in favs} == {song_1.id, song_2.id}

        await _cleanup_favorites(session, user_a.id)


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_list_empty_for_unknown_user(session_factory):
    """Listing favorites for a user with no account returns empty list."""
    async with session_factory() as session:
        svc = FavoriteService(session)
        favs = await svc.list_favorites("nonexistent-sub-xyz")
        assert favs == []


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_list_user_isolation(session_factory):
    """User A's favorites are not visible to User B."""
    async with session_factory() as session:
        user_a, user_b, song_1, song_2 = await _setup(session)
        svc = FavoriteService(session)

        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_2.id)
        await svc.add_favorite(TEST_USER_B_SUB, TEST_USER_B_EMAIL, song_1.id)
        await session.commit()

        user_a_favs = await svc.list_favorites(TEST_USER_A_SUB)
        user_b_favs = await svc.list_favorites(TEST_USER_B_SUB)

        assert len(user_a_favs) == 2
        assert len(user_b_favs) == 1
        assert {f.song_id for f in user_a_favs} == {song_1.id, song_2.id}
        assert {f.song_id for f in user_b_favs} == {song_1.id}

        await _cleanup_favorites(session, user_a.id, user_b.id)


# ── Remove ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_remove_favorite(session_factory):
    """Removing a favorite makes it disappear from the list."""
    async with session_factory() as session:
        user_a, _, song_1, song_2 = await _setup(session)
        svc = FavoriteService(session)

        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_2.id)
        await session.commit()

        await svc.remove_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await session.commit()

        favs = await svc.list_favorites(TEST_USER_A_SUB)
        assert len(favs) == 1
        assert favs[0].song_id == song_2.id

        await _cleanup_favorites(session, user_a.id)


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_remove_nonexistent_raises(session_factory):
    """Removing a favorite that doesn't exist raises NotFoundError."""
    async with session_factory() as session:
        user_a, _, song_1, _ = await _setup(session)
        svc = FavoriteService(session)

        with pytest.raises(NotFoundError):
            await svc.remove_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_remove_does_not_affect_other_user(session_factory):
    """Removing User A's favorite does not affect User B's favorites."""
    async with session_factory() as session:
        user_a, user_b, song_1, _ = await _setup(session)
        svc = FavoriteService(session)

        await svc.add_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await svc.add_favorite(TEST_USER_B_SUB, TEST_USER_B_EMAIL, song_1.id)
        await session.commit()

        await svc.remove_favorite(TEST_USER_A_SUB, TEST_USER_A_EMAIL, song_1.id)
        await session.commit()

        user_b_favs = await svc.list_favorites(TEST_USER_B_SUB)
        assert len(user_b_favs) == 1
        assert user_b_favs[0].song_id == song_1.id

        await _cleanup_favorites(session, user_a.id, user_b.id)
