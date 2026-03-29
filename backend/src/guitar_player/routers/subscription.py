"""Subscription endpoints and payment webhook handler.

Provider-agnostic — the router delegates to whichever PaymentProvider
is active (AllPay or Paddle) via the dependency factory.
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.admin import require_admin_user
from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.auth.subscription_guard import _is_bypass_user
from guitar_player.config import Settings, get_settings
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.dependencies import get_db, get_payment_provider, get_telegram_service
from guitar_player.schemas.subscription import (
    CancelSubscriptionResponse,
    CheckoutRequest,
    CheckoutResponse,
    OkResponse,
    PricesResponse,
    SubscriptionStatusResponse,
    WebhookOkResponse,
)
from guitar_player.services.analytics_helpers import (
    analytics_identity_from_user,
    track_event,
)
from guitar_player.services.payment_provider import PaymentProviderProtocol
from guitar_player.services.subscription_service import OnboardingService
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)

ONBOARDING_SONG_NAME = "rem/losing_my_religion"

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("/status", response_model=SubscriptionStatusResponse)
async def get_subscription_status(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
    session: AsyncSession = Depends(get_db),
    telegram: TelegramService = Depends(get_telegram_service),
    settings: Settings = Depends(get_settings),
) -> SubscriptionStatusResponse:
    user_dao = UserDAO(session)
    is_new = (await user_dao.get_by_cognito_sub(user.sub)) is None

    sub_status = await provider.get_status(user.sub, user.email)
    if not sub_status.has_access and _is_bypass_user(user.email, settings):
        sub_status.has_access = True

    db_user = await user_dao.get_or_create(user.sub, user.email)
    sub_status.has_seen_onboarding = db_user.has_seen_onboarding
    sub_status.is_admin = user.email in settings.admin_users

    if not db_user.has_seen_onboarding:
        song_dao = SongDAO(session)
        onboarding_song = await song_dao.get_by_song_name(ONBOARDING_SONG_NAME)
        if onboarding_song:
            sub_status.onboarding_song_id = str(onboarding_song.id)

    if is_new:
        method = "Google OAuth" if user.username.startswith("Google_") else "email/password"
        track_event(
            background_tasks,
            event_type="user_provisioned",
            event_category="auth",
            **analytics_identity_from_user(user),
            properties={"method": method},
        )
        logger.info(
            "New user registered (%s): %s",
            method,
            user.email,
            extra={"email": user.email, "event_type": "user_registered"},
        )
        await telegram.send_event(
            f"<b>New user registered</b>\nEmail: {user.email}\nMethod: {method}"
        )

    return sub_status


@router.get("/prices", response_model=PricesResponse)
async def get_prices(
    user: CurrentUser = Depends(get_current_user),
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
) -> PricesResponse:
    return await provider.get_prices()


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    body: CheckoutRequest,
    user: CurrentUser = Depends(get_current_user),
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
) -> CheckoutResponse:
    if body.plan_type not in ("monthly", "yearly"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="plan_type must be monthly or yearly",
        )
    return await provider.create_checkout(user.sub, user.email, body.plan_type)


@router.post("/onboarding-seen", response_model=OkResponse)
async def mark_onboarding_seen(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> OkResponse:
    service = OnboardingService(session)
    await service.mark_seen(user.sub, user.email)
    return OkResponse()


@router.post("/onboarding-reset", response_model=OkResponse)
async def reset_onboarding(
    user: CurrentUser = Depends(require_admin_user),
    session: AsyncSession = Depends(get_db),
) -> OkResponse:
    service = OnboardingService(session)
    await service.reset(user.sub, user.email)
    return OkResponse()


@router.post("/cancel", response_model=CancelSubscriptionResponse)
async def cancel_subscription(
    user: CurrentUser = Depends(get_current_user),
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
) -> CancelSubscriptionResponse:
    return await provider.cancel_subscription(user.sub, user.email)


# --- Webhook endpoint (NO auth — called by payment provider) ---

webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@webhook_router.post("/payment", response_model=WebhookOkResponse)
async def payment_webhook(
    request: Request,
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
    telegram: TelegramService = Depends(get_telegram_service),
) -> WebhookOkResponse:
    """Handle payment provider webhook callbacks.

    The active provider handles its own signature verification and
    payload parsing internally.
    """
    try:
        await provider.handle_webhook(request)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc),
        )
    except Exception as exc:
        logger.exception("Webhook processing error")
        await telegram.send_error(
            f"<b>Webhook Error</b>\n"
            f"<b>Error:</b> {type(exc).__name__}: {str(exc)[:300]}"
        )
        # Return 200 to avoid provider retrying for app-level errors

    return WebhookOkResponse()
