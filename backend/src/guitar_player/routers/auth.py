"""Auth endpoints — registration, confirmation, login, token refresh."""

import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from guitar_player.config import get_settings
from jose import jwt as jose_jwt

from guitar_player.schemas.auth import (
    ConfirmRequest,
    ConfirmResponse,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    ResendCodeRequest,
    ResendCodeResponse,
)
from guitar_player.services.cognito_auth_service import CognitoAuthError, CognitoAuthService
from guitar_player.services.telegram_service import TelegramService
from guitar_player.dependencies import get_cognito_auth_service, get_telegram_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Cognito error code → HTTP status
_ERROR_STATUS_MAP: dict[str, int] = {
    "UsernameExistsException": 409,
    "InvalidPasswordException": 400,
    "InvalidParameterException": 400,
    "NotAuthorizedException": 401,
    "UserNotConfirmedException": 403,
    "UserNotFoundException": 404,
    "TooManyRequestsException": 429,
}


def _cognito_to_http(exc: CognitoAuthError) -> HTTPException:
    status = _ERROR_STATUS_MAP.get(exc.code, 500)
    return HTTPException(status_code=status, detail=exc.message)


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(
    body: RegisterRequest,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> RegisterResponse:
    try:
        result = auth_service.register(body.email, body.password)
        logger.info("New user registered: %s", body.email, extra={"email": body.email, "event_type": "user_registered"})
        return RegisterResponse(
            user_sub=result["user_sub"],
            user_confirmed=result["user_confirmed"],
            message="User registered. Check email for confirmation code.",
        )
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm(
    body: ConfirmRequest,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
    telegram: TelegramService = Depends(get_telegram_service),
) -> ConfirmResponse:
    try:
        auth_service.confirm(body.email, body.confirmation_code)
        logger.info("User confirmed email: %s", body.email, extra={"email": body.email, "event_type": "user_confirmed"})
        await telegram.send_event(
            f"<b>New user registered</b>\nEmail: {body.email}\nMethod: email/password"
        )
        return ConfirmResponse(message="Email confirmed successfully.")
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)


@router.post("/resend-code", response_model=ResendCodeResponse)
def resend_code(
    body: ResendCodeRequest,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> ResendCodeResponse:
    try:
        auth_service.resend_confirmation_code(body.email)
        return ResendCodeResponse(message="Verification code resent.")
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)


@router.post("/login", response_model=LoginResponse)
def login(
    body: LoginRequest,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> LoginResponse:
    settings = get_settings()
    if settings.environment == "local" and os.environ.get("SKIP_AUTH") == "1":
        claims = {"sub": f"local-{body.email}", "email": body.email}
        fake_token = jose_jwt.encode(claims, "dev-secret", algorithm="HS256")
        return LoginResponse(
            access_token=fake_token,
            id_token=fake_token,
            refresh_token="local-dev-refresh-token",
            expires_in=3600,
        )
    try:
        tokens = auth_service.login(body.email, body.password)
        return LoginResponse(**tokens)
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)


@router.post("/refresh", response_model=RefreshResponse)
def refresh(
    body: RefreshRequest,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> RefreshResponse:
    settings = get_settings()
    if settings.environment == "local" and os.environ.get("SKIP_AUTH") == "1":
        # Decode email from the existing token if available
        fake_token = jose_jwt.encode(
            {"sub": "local-dev-user", "email": "dev@local.test"},
            "dev-secret", algorithm="HS256",
        )
        return RefreshResponse(
            access_token=fake_token,
            id_token=fake_token,
            expires_in=3600,
        )
    try:
        tokens = auth_service.refresh_tokens(body.refresh_token)
        return RefreshResponse(**tokens)
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)
