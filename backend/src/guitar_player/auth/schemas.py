"""Auth schemas."""

from pydantic import BaseModel


class CurrentUser(BaseModel):
    sub: str
    email: str
    username: str = ""


class MemberAccess(BaseModel):
    """A signed-in member and whether they have Pro (trial or paid) access."""

    user: CurrentUser
    is_pro: bool
