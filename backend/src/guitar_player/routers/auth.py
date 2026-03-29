"""Auth endpoints -- registration, confirmation, login, token refresh."""

import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from jose import jwt as jose_jwt

from guitar_player.config import get_settings
from guitar_player.dependencies import get_cognito_auth_service, get_telegram_service
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
from guitar_player.services.analytics_helpers import track_event
from guitar_player.services.cognito_auth_service import (
    CognitoAuthError,
    CognitoAuthService,
)
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_ERROR_STATUS_MAP: dict[str, int] = {
    "UsernameExistsException": status.HTTP_409_CONFLICT,
    "InvalidPasswordException": status.HTTP_400_BAD_REQUEST,
    "InvalidParameterException": status.HTTP_400_BAD_REQUEST,
    "NotAuthorizedException": status.HTTP_401_UNAUTHORIZED,
    "UserNotConfirmedException": status.HTTP_403_FORBIDDEN,
    "UserNotFoundException": status.HTTP_404_NOT_FOUND,
    "TooManyRequestsException": status.HTTP_429_TOO_MANY_REQUESTS,
}


def _cognito_to_http(exc: CognitoAuthError) -> HTTPException:
    http_status = _ERROR_STATUS_MAP.get(exc.code, status.HTTP_500_INTERNAL_SERVER_ERROR)
    return HTTPException(status_code=http_status, detail=exc.message)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    body: RegisterRequest,
    background_tasks: BackgroundTasks,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> RegisterResponse:
    try:
        result = auth_service.register(body.email, body.password)
        track_event(
            background_tasks,
            event_type="register",
            event_category="auth",
            user_email=body.email,
            properties={"method": "email_password"},
        )
        logger.info(
            "New user registered: %s",
            body.email,
            extra={"email": body.email, "event_type": "user_registered"},
        )
        return RegisterResponse(
            user_sub=result.user_sub,
            user_confirmed=result.user_confirmed,
            message="User registered. Check email for confirmation code.",
        )
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm(
    body: ConfirmRequest,
    background_tasks: BackgroundTasks,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
    telegram: TelegramService = Depends(get_telegram_service),
) -> ConfirmResponse:
    try:
        auth_service.confirm(body.email, body.confirmation_code)
        track_event(
            background_tasks,
            event_type="email_confirmed",
            event_category="auth",
            user_email=body.email,
            properties={"method": "email_password"},
        )
        logger.info(
            "User confirmed email: %s",
            body.email,
            extra={"email": body.email, "event_type": "user_confirmed"},
        )
        await telegram.send_event(
            f"<b>User confirmed email</b>\nEmail: {body.email}\nMethod: email/password"
        )
        return ConfirmResponse(message="Email confirmed successfully.")
    except CognitoAuthError as exc:
        if exc.code in ("CodeMismatchException", "ExpiredCodeException"):
            await telegram.send_error(
                f"<b>Bad auth code</b>\n"
                f"<b>Email:</b> {body.email}\n"
                f"<b>Error:</b> {exc.code}: {exc.message}"
            )
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
    background_tasks: BackgroundTasks,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> LoginResponse:
    settings = get_settings()
    if settings.environment == "local" and os.environ.get("SKIP_AUTH") == "1":
        claims = {"sub": f"local-{body.email}", "email": body.email}
        fake_token = jose_jwt.encode(claims, "dev-secret", algorithm="HS256")
        track_event(
            background_tasks,
            event_type="login",
            event_category="auth",
            user_sub=claims["sub"],
            user_email=body.email,
            properties={"method": "email_password", "mode": "local_skip_auth"},
        )
        return LoginResponse(
            access_token=fake_token,
            id_token=fake_token,
            refresh_token="local-dev-refresh-token",
            expires_in=3600,
        )
    try:
        tokens = auth_service.login(body.email, body.password)
        track_event(
            background_tasks,
            event_type="login",
            event_category="auth",
            user_email=body.email,
            properties={"method": "email_password"},
        )
        return LoginResponse(
            access_token=tokens.access_token,
            id_token=tokens.id_token,
            refresh_token=tokens.refresh_token,
            expires_in=tokens.expires_in,
        )
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)


@router.post("/refresh", response_model=RefreshResponse)
def refresh(
    body: RefreshRequest,
    auth_service: CognitoAuthService = Depends(get_cognito_auth_service),
) -> RefreshResponse:
    settings = get_settings()
    if settings.environment == "local" and os.environ.get("SKIP_AUTH") == "1":
        fake_token = jose_jwt.encode(
            {"sub": "local-dev-user", "email": "dev@local.test"},
            "dev-secret",
            algorithm="HS256",
        )
        return RefreshResponse(
            access_token=fake_token,
            id_token=fake_token,
            expires_in=3600,
        )
    try:
        tokens = auth_service.refresh_tokens(body.refresh_token)
        return RefreshResponse(
            access_token=tokens.access_token,
            id_token=tokens.id_token,
            expires_in=tokens.expires_in,
        )
    except CognitoAuthError as exc:
        raise _cognito_to_http(exc)
