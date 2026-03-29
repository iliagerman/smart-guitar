"""Pydantic schemas for auth endpoints."""

from typing import Any

from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterResponse(BaseModel):
    user_sub: str
    user_confirmed: bool
    message: str


class ConfirmRequest(BaseModel):
    email: EmailStr
    confirmation_code: str


class ConfirmResponse(BaseModel):
    message: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    id_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "Bearer"


class ResendCodeRequest(BaseModel):
    email: EmailStr


class ResendCodeResponse(BaseModel):
    message: str


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    id_token: str
    expires_in: int
    token_type: str = "Bearer"


# -- Cognito service response models --


class CognitoRegisterResult(BaseModel):
    """Result of a Cognito sign-up call."""

    user_sub: str
    user_confirmed: bool
    code_delivery: dict[str, Any] | None = None


class CognitoTokenResult(BaseModel):
    """Tokens returned by Cognito login."""

    access_token: str
    id_token: str
    refresh_token: str
    expires_in: int


class CognitoRefreshResult(BaseModel):
    """Tokens returned by Cognito token refresh (no new refresh_token)."""

    access_token: str
    id_token: str
    expires_in: int


class CognitoCodeDeliveryResult(BaseModel):
    """Result of resending a confirmation code."""

    code_delivery: dict[str, Any] | None = None
