"""Subscription endpoints and payment webhook handler.

Provider-agnostic — the router delegates to whichever PaymentProvider
is active (AllPay or Paddle) via the dependency factory.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.dependencies import get_payment_provider, get_telegram_service
from guitar_player.schemas.subscription import (
    CancelSubscriptionResponse,
    CheckoutRequest,
    CheckoutResponse,
    PricesResponse,
    SubscriptionStatusResponse,
)
from guitar_player.services.payment_provider import PaymentProviderProtocol
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("/status", response_model=SubscriptionStatusResponse)
async def get_subscription_status(
    user: CurrentUser = Depends(get_current_user),
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
) -> SubscriptionStatusResponse:
    return await provider.get_status(user.sub, user.email)


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
            status_code=400, detail="plan_type must be monthly or yearly"
        )
    return await provider.create_checkout(user.sub, user.email, body.plan_type)


@router.post("/cancel", response_model=CancelSubscriptionResponse)
async def cancel_subscription(
    user: CurrentUser = Depends(get_current_user),
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
) -> CancelSubscriptionResponse:
    return await provider.cancel_subscription(user.sub, user.email)


# --- Webhook endpoint (NO auth — called by payment provider) ---

webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@webhook_router.post("/payment")
async def payment_webhook(
    request: Request,
    provider: PaymentProviderProtocol = Depends(get_payment_provider),
    telegram: TelegramService = Depends(get_telegram_service),
) -> dict:
    """Handle payment provider webhook callbacks.

    The active provider handles its own signature verification and
    payload parsing internally.
    """
    try:
        await provider.handle_webhook(request)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        logger.exception("Webhook processing error")
        await telegram.send_error(
            f"<b>Webhook Error</b>\n"
            f"<b>Error:</b> {type(exc).__name__}: {str(exc)[:300]}"
        )
        # Return 200 to avoid provider retrying for app-level errors

    return {"status": "ok"}
