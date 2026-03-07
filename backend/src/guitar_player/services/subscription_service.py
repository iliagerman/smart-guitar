"""Paddle payment provider — manages subscription state via Paddle API.

Kept intact for potential re-enablement. Implements the same interface
as AllPayProvider so the dependency factory can swap between them.
"""

import asyncio
import hashlib
import hmac
import logging
import uuid as uuid_mod
from datetime import datetime, timezone

import httpx
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.config import Settings
from guitar_player.dao.subscription_dao import SubscriptionDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.enums import PaymentProvider
from guitar_player.schemas.subscription import (
    CancelSubscriptionResponse,
    CheckoutResponse,
    PriceDetail,
    PricesResponse,
    SubscriptionDetail,
    SubscriptionStatusResponse,
)
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)

PROVIDER = PaymentProvider.PADDLE


class PaddleProvider:
    """Paddle payment provider implementing PaymentProviderProtocol."""

    def __init__(
        self, session: AsyncSession, settings: Settings, telegram: TelegramService
    ) -> None:
        self._session = session
        self._settings = settings
        self._telegram = telegram
        self._subscription_dao = SubscriptionDAO(session)
        self._user_dao = UserDAO(session)
        self._paddle_api_base = (
            "https://sandbox-api.paddle.com"
            if settings.paddle.environment == "sandbox"
            else "https://api.paddle.com"
        )

    async def get_status(
        self, user_sub: str, user_email: str
    ) -> SubscriptionStatusResponse:
        """Check if user has active trial or subscription."""
        user = await self._user_dao.get_or_create(user_sub, user_email)
        now = datetime.now(timezone.utc)

        # If the user ever had a real subscription, trial no longer grants access.
        ever_subscribed = await self._subscription_dao.has_any_subscription(user.id)
        trial_active = (
            not ever_subscribed
            and bool(user.trial_ends_at and user.trial_ends_at > now)
        )

        sub = await self._subscription_dao.get_active_by_user(user.id)

        # Check for canceled subscription still within paid period
        canceled_sub = None
        if not sub:
            canceled_sub = await self._subscription_dao.get_canceled_with_access(user.id)

        active_sub = sub or canceled_sub
        sub_detail = None
        if active_sub:
            sub_detail = SubscriptionDetail(
                status=active_sub.status,
                plan_type=active_sub.plan_type,
                current_period_end=active_sub.current_period_end,
                canceled_at=active_sub.canceled_at,
            )

        has_access = trial_active or (active_sub is not None)

        return SubscriptionStatusResponse(
            has_access=has_access,
            trial_ends_at=user.trial_ends_at,
            trial_active=trial_active,
            subscription=sub_detail,
        )

    async def get_prices(self) -> PricesResponse:
        """Fetch dynamic pricing from the Paddle API."""
        api_key = self._settings.paddle.api_key
        price_monthly_id = self._settings.paddle.price_monthly
        price_yearly_id = self._settings.paddle.price_yearly

        if not api_key or not price_monthly_id or not price_yearly_id:
            return PricesResponse()

        monthly = None
        yearly = None

        async with httpx.AsyncClient() as client:
            for price_id in [price_monthly_id, price_yearly_id]:
                try:
                    response = await client.get(
                        f"{self._paddle_api_base}/prices/{price_id}",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                        },
                        params={"include": "product"},
                    )
                    response.raise_for_status()
                    data = response.json().get("data", {})

                    unit_price = data.get("unit_price", {})
                    billing_cycle = data.get("billing_cycle", {})
                    product = data.get("product", {})

                    detail = PriceDetail(
                        id=data.get("id", price_id),
                        name=product.get("name", ""),
                        amount=unit_price.get("amount", "0"),
                        currency=unit_price.get("currency_code", "USD"),
                        interval=billing_cycle.get("interval", ""),
                    )

                    if price_id == price_monthly_id:
                        monthly = detail
                    else:
                        yearly = detail
                except httpx.HTTPError:
                    logger.exception(
                        "Failed to fetch price %s from Paddle", price_id
                    )

        return PricesResponse(monthly=monthly, yearly=yearly)

    async def create_checkout(
        self, user_sub: str, user_email: str, plan_type: str
    ) -> CheckoutResponse:
        """Create a Paddle checkout session.

        NOTE: Since we now use a unified redirect-based flow, this would
        need Paddle's hosted checkout URL. For now, Paddle is disabled —
        this is a placeholder for future re-enablement.
        """
        raise NotImplementedError(
            "Paddle redirect-based checkout not yet implemented. "
            "Re-enable Paddle overlay checkout or implement hosted checkout."
        )

    async def cancel_subscription(
        self, user_sub: str, user_email: str
    ) -> CancelSubscriptionResponse:
        """Cancel the user's subscription at period end via Paddle API."""
        user = await self._user_dao.get_or_create(user_sub, user_email)
        sub = await self._subscription_dao.get_active_by_user(user.id)

        if not sub:
            return CancelSubscriptionResponse(
                message="No active subscription found."
            )

        api_key = self._settings.paddle.api_key
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._paddle_api_base}/subscriptions/{sub.external_subscription_id}/cancel",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"effective_from": "next_billing_period"},
            )
            response.raise_for_status()

        await self._subscription_dao.update(
            sub,
            status="canceled",
            canceled_at=datetime.now(timezone.utc),
        )

        return CancelSubscriptionResponse(
            message="Subscription will cancel at end of current period.",
            effective_date=sub.current_period_end,
        )

    async def handle_webhook(self, request: Request) -> None:
        """Handle Paddle webhook events.

        Paddle sends POST with JSON body and Paddle-Signature header.
        """
        body = await request.body()

        # Verify webhook signature if webhook_secret is configured
        paddle_signature = request.headers.get("Paddle-Signature", "")
        if self._settings.paddle.webhook_secret:
            if not _verify_paddle_signature(
                body, paddle_signature, self._settings.paddle.webhook_secret
            ):
                raise ValueError("Invalid Paddle webhook signature")

        payload = await request.json()
        event_type = payload.get("event_type", "")
        data = payload.get("data", {})

        logger.info("Paddle webhook received: %s", event_type)

        if event_type == "subscription.created":
            await self._handle_subscription_created(data)
        elif event_type == "subscription.updated":
            await self._handle_subscription_updated(data)
        elif event_type == "subscription.canceled":
            await self._handle_subscription_canceled(data)
        elif event_type == "subscription.paused":
            await self._handle_subscription_paused(data)
        else:
            logger.info("Ignoring webhook event: %s", event_type)

    async def _handle_subscription_created(self, data: dict) -> None:
        paddle_sub_id = data.get("id", "")
        paddle_customer_id = data.get("customer_id", "")
        custom_data = data.get("custom_data", {})
        user_id_str = custom_data.get("user_id")
        cognito_sub = custom_data.get("cognito_sub")
        status = data.get("status", "active")

        # Determine plan type from items
        items = data.get("items", [])
        price_id = (
            items[0].get("price", {}).get("id", "") if items else ""
        )
        plan_type = "monthly"
        if price_id == self._settings.paddle.price_yearly:
            plan_type = "yearly"

        current_period = data.get("current_billing_period", {})
        period_start = _parse_datetime(current_period.get("starts_at"))
        period_end = _parse_datetime(current_period.get("ends_at"))

        # Find user
        user = None
        if user_id_str:
            user = await self._user_dao.get_by_id(
                uuid_mod.UUID(user_id_str)
            )
        if not user and cognito_sub:
            user = await self._user_dao.get_by_cognito_sub(cognito_sub)
        if not user:
            logger.error(
                "Webhook: could not find user for subscription %s",
                paddle_sub_id,
            )
            return

        existing = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, paddle_sub_id
        )
        if existing:
            await self._subscription_dao.update(
                existing,
                status=status,
                current_period_start=period_start,
                current_period_end=period_end,
            )
        else:
            await self._subscription_dao.create(
                user_id=user.id,
                provider=PROVIDER.value,
                external_subscription_id=paddle_sub_id,
                external_customer_id=paddle_customer_id,
                status=status,
                plan_type=plan_type,
                current_period_start=period_start,
                current_period_end=period_end,
            )

        await self._telegram.send_event(
            f"<b>New subscription</b>\n"
            f"Email: {user.email}\n"
            f"Plan: {plan_type}"
        )

    async def _handle_subscription_updated(self, data: dict) -> None:
        paddle_sub_id = data.get("id", "")
        sub = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, paddle_sub_id
        )
        if not sub:
            logger.warning(
                "Webhook: subscription not found: %s", paddle_sub_id
            )
            return

        status = data.get("status", sub.status)
        current_period = data.get("current_billing_period", {})
        period_start = _parse_datetime(current_period.get("starts_at"))
        period_end = _parse_datetime(current_period.get("ends_at"))

        canceled_at_str = data.get("canceled_at")
        canceled_at = (
            _parse_datetime(canceled_at_str)
            if canceled_at_str
            else sub.canceled_at
        )

        await self._subscription_dao.update(
            sub,
            status=status,
            current_period_start=period_start or sub.current_period_start,
            current_period_end=period_end or sub.current_period_end,
            canceled_at=canceled_at,
        )

    async def _handle_subscription_canceled(self, data: dict) -> None:
        paddle_sub_id = data.get("id", "")
        sub = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, paddle_sub_id
        )
        if not sub:
            logger.warning(
                "Webhook: subscription not found: %s", paddle_sub_id
            )
            return

        await self._subscription_dao.update(
            sub,
            status="canceled",
            canceled_at=datetime.now(timezone.utc),
        )

        user = await self._user_dao.get_by_id(sub.user_id)
        user_email = user.email if user else "unknown"
        await self._telegram.send_event(
            f"<b>Subscription canceled</b>\n"
            f"Email: {user_email}"
        )

    async def _handle_subscription_paused(self, data: dict) -> None:
        paddle_sub_id = data.get("id", "")
        sub = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, paddle_sub_id
        )
        if not sub:
            return

        await self._subscription_dao.update(sub, status="paused")


def _verify_paddle_signature(
    body: bytes, signature_header: str, secret: str
) -> bool:
    """Verify the Paddle webhook signature.

    Paddle-Signature header format: ts=<timestamp>;h1=<hmac_sha256_hex>
    The signed payload is: <timestamp>:<body>
    """
    if not signature_header:
        return False

    parts: dict[str, str] = {}
    for part in signature_header.split(";"):
        key, _, value = part.partition("=")
        parts[key] = value

    ts = parts.get("ts", "")
    h1 = parts.get("h1", "")
    if not ts or not h1:
        return False

    signed_payload = f"{ts}:{body.decode('utf-8')}"
    expected = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, h1)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
