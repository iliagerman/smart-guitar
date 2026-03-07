"""Auth schemas."""

from pydantic import BaseModel


class CurrentUser(BaseModel):
    sub: str
    email: str
    username: str = ""
