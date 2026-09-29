"""The local dev user must survive other accounts sharing its email."""

from uuid import uuid4

from guitar_player.dao.user_dao import UserDAO
from guitar_player.services.sync_service import ensure_default_user


async def test_default_user_ignores_other_accounts_with_the_same_email(session_factory):
    email = f"dup-{uuid4().hex[:8]}@example.com"
    async with session_factory() as session:
        dao = UserDAO(session)
        await dao.create(cognito_sub=f"cognito-{uuid4()}", email=email)
        await dao.create(cognito_sub=f"other-{uuid4()}", email=email)
        await session.commit()

        user = await ensure_default_user(session, email)
        again = await ensure_default_user(session, email)

    assert user.cognito_sub == f"local-{email}"
    assert again.id == user.id
