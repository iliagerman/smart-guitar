"""AllPay payment provider — manages subscriptions via AllPay.to API."""

from __future__ import annotations

import hashlib
import logging
import uuid as uuid_mod
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.config import Settings
from guitar_player.dao.subscription_dao import SubscriptionDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.models.subscription import Subscription
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

PROVIDER = PaymentProvider.ALLPAY


def _allpay_sign(params: dict, api_key: str) -> str:
    """Compute AllPay SHA256 signature.

    Algorithm:
    1. Exclude 'sign' key and empty values
    2. Sort keys alphabetically
    3. For arrays: recurse into each object, sorting its keys alphabetically
    4. Collect all non-empty string values
    5. Join with ':', append ':' + api_key
    6. SHA256 hex digest
    """
    chunks: list[str] = []

    for key in sorted(params.keys()):
        if key == "sign":
            continue
        value = params[key]
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    for item_key in sorted(item.keys()):
                        val = item[item_key]
                        if isinstance(val, str) and val.strip():
                            chunks.append(val)
                        elif isinstance(val, (int, float)):
                            chunks.append(str(val))
        elif isinstance(value, dict):
            for sub_key in sorted(value.keys()):
                val = value[sub_key]
                if isinstance(val, str) and val.strip():
                    chunks.append(val)
                elif isinstance(val, (int, float)):
                    chunks.append(str(val))
        elif isinstance(value, str) and value.strip():
            chunks.append(value)
        elif isinstance(value, (int, float)):
            chunks.append(str(value))

    signature_string = ":".join(chunks) + ":" + api_key
    return hashlib.sha256(signature_string.encode("utf-8")).hexdigest()


class AllPayProvider:
    """AllPay payment provider implementing PaymentProviderProtocol."""

    def __init__(
        self, session: AsyncSession, settings: Settings, telegram: TelegramService
    ) -> None:
        self._session = session
        self._settings = settings
        self._telegram = telegram
        self._subscription_dao = SubscriptionDAO(session)
        self._user_dao = UserDAO(session)
        self._cfg = settings.allpay

    async def get_status(
        self, user_sub: str, user_email: str
    ) -> SubscriptionStatusResponse:
        user = await self._user_dao.get_or_create(user_sub, user_email)
        now = datetime.now(timezone.utc)

        # If the user ever had a real subscription, trial no longer grants access.
        ever_subscribed = await self._subscription_dao.has_any_subscription(user.id)
        trial_active = (
            not ever_subscribed
            and bool(user.trial_ends_at and user.trial_ends_at > now)
        )

        sub = await self._subscription_dao.get_active_by_user(user.id)

        # If no active sub, check for pending ones and verify with AllPay.
        # This handles cases where the webhook didn't reach us.
        if not sub:
            pending = await self._subscription_dao.get_pending_by_user(user.id)
            if pending:
                sub = await self._verify_and_activate(pending, now)

        # If we have an active sub, verify it's still active with AllPay.
        # This detects cancellations made directly in AllPay's dashboard.
        if sub and sub.provider == PROVIDER.value and sub.status == "active":
            sub = await self._check_subscription_still_active(sub, now)

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

        return SubscriptionStatusResponse(
            has_access=trial_active or (active_sub is not None),
            trial_ends_at=user.trial_ends_at,
            trial_active=trial_active,
            subscription=sub_detail,
        )

    async def get_prices(self) -> PricesResponse:
        """Return static pricing from config (AllPay has no prices API)."""
        return PricesResponse(
            monthly=PriceDetail(
                id="allpay_monthly",
                name="Smart Guitar Pro",
                amount=self._cfg.price_monthly_display,
                currency=self._cfg.currency,
                interval="month",
            ),
            yearly=None,
        )

    async def create_checkout(
        self, user_sub: str, user_email: str, plan_type: str
    ) -> CheckoutResponse:
        """Create an AllPay payment session and return the payment URL."""
        user = await self._user_dao.get_or_create(user_sub, user_email)

        order_id = str(uuid_mod.uuid4())

        params: dict = {
            "login": self._cfg.login,
            "order_id": order_id,
            "currency": self._cfg.currency,
            "lang": "EN",
            "client_email": user.email,
            "success_url": self._cfg.success_url or "",
            "webhook_url": self._cfg.webhook_url or "",
            "add_field_1": f"{user.id}|{user_sub}",
            "items": [
                {
                    "name": "Smart Guitar Pro Monthly",
                    "price": self._cfg.price_monthly_display,
                    "qty": "1",
                    "vat": "0",
                }
            ],
            "subscription": {
                "start_type": 1,
                "end_type": 1,
            },
        }
        params["sign"] = _allpay_sign(params, self._cfg.api_key or "")

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._cfg.api_base}?show=getpayment&mode=api10",
                json=params,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

        payment_url = data.get("payment_url")
        if not payment_url:
            logger.error("AllPay did not return payment_url: %s", data)
            raise ValueError("Failed to create AllPay checkout session")

        # Store pending subscription so we can verify with AllPay later
        # (handles cases where the webhook doesn't reach us).
        existing = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, order_id
        )
        if not existing:
            await self._subscription_dao.create(
                user_id=user.id,
                provider=PROVIDER.value,
                external_subscription_id=order_id,
                external_customer_id=str(user.id),
                status="pending",
                plan_type="monthly",
            )

        return CheckoutResponse(payment_url=payment_url)

    async def cancel_subscription(
        self, user_sub: str, user_email: str
    ) -> CancelSubscriptionResponse:
        user = await self._user_dao.get_or_create(user_sub, user_email)
        sub = await self._subscription_dao.get_active_by_user(user.id)

        if not sub or sub.provider != PROVIDER.value:
            return CancelSubscriptionResponse(
                message="No active subscription found."
            )

        params = {
            "login": self._cfg.login or "",
            "order_id": sub.external_subscription_id,
        }
        params["sign"] = _allpay_sign(params, self._cfg.api_key or "")

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._cfg.api_base}?show=cancelsubscription&mode=api10",
                json=params,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()

        await self._subscription_dao.update(
            sub,
            status="canceled",
            canceled_at=datetime.now(timezone.utc),
        )

        return CancelSubscriptionResponse(
            message="Subscription canceled.",
            effective_date=sub.current_period_end,
        )

    async def _verify_and_activate(
        self, pending: Subscription, now: datetime
    ) -> Subscription | None:
        """Check AllPay payment status for a pending subscription.

        If AllPay confirms the payment succeeded, activate the subscription
        in the DB and return it. Returns None if not yet paid.
        Skips verification for checkouts older than 1 hour (abandoned).
        """
        # Don't keep hitting AllPay for abandoned checkouts
        if pending.created_at and (now - pending.created_at) > timedelta(hours=1):
            return None

        order_id = pending.external_subscription_id
        try:
            params = {
                "login": self._cfg.login or "",
                "order_id": order_id,
            }
            params["sign"] = _allpay_sign(params, self._cfg.api_key or "")

            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self._cfg.api_base}?show=paymentstatus&mode=api10",
                    json=params,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

            # AllPay paymentstatus: status 1 = successful
            status = str(data.get("status", ""))
            if status == "1":
                period_end = now + timedelta(days=30)
                await self._subscription_dao.update(
                    pending,
                    status="active",
                    current_period_start=now,
                    current_period_end=period_end,
                )
                return pending
        except Exception:
            logger.exception(
                "Failed to verify AllPay payment status for order %s",
                order_id,
            )
        return None

    async def _check_subscription_still_active(
        self, sub: Subscription, now: datetime
    ) -> Subscription | None:
        """Verify an active subscription is still active with AllPay.

        Calls the subscriptionstatus API. If AllPay reports the subscription
        as cancelled (status 4), updates the local DB and returns None.
        Returns the subscription unchanged if still active or on API error
        (fail-open to avoid blocking users on transient failures).
        """
        order_id = sub.external_subscription_id
        try:
            params = {
                "login": self._cfg.login or "",
                "order_id": order_id,
            }
            params["sign"] = _allpay_sign(params, self._cfg.api_key or "")

            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self._cfg.api_base}?show=subscriptionstatus&mode=api10",
                    json=params,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

            status = str(data.get("status", ""))
            if status == "4":
                # Subscription cancelled in AllPay
                logger.info(
                    "AllPay subscription %s cancelled externally, updating DB",
                    order_id,
                )
                await self._subscription_dao.update(
                    sub, status="canceled", canceled_at=now
                )
                return None
        except Exception:
            logger.exception(
                "Failed to check AllPay subscription status for order %s",
                order_id,
            )
            # Fail open — don't revoke access on API errors
        return sub

    async def handle_webhook(self, request: Request) -> None:
        """Process an AllPay webhook callback.

        AllPay POSTs payment results to the configured webhook_url.
        """
        content_type = request.headers.get("content-type", "")
        if "form" in content_type:
            form_data = await request.form()
            payload = dict(form_data)
        else:
            payload = await request.json()

        # Verify signature
        received_sign = payload.pop("sign", "")
        expected_sign = _allpay_sign(payload, self._cfg.api_key or "")
        if received_sign != expected_sign:
            logger.warning("AllPay webhook signature mismatch")
            raise ValueError("Invalid AllPay webhook signature")

        status = str(payload.get("status", ""))
        order_id = str(payload.get("order_id", ""))
        add_field_1 = str(payload.get("add_field_1", ""))

        # Parse custom data: "user_id|cognito_sub"
        parts = add_field_1.split("|", 1)
        user_id_str = parts[0] if parts else None
        cognito_sub = parts[1] if len(parts) > 1 else None

        if status == "1" and order_id:
            # Payment successful
            await self._handle_subscription_activated(
                order_id=order_id,
                user_id_str=user_id_str,
                cognito_sub=cognito_sub,
            )
        elif status == "4":
            # Subscription canceled
            await self._handle_subscription_canceled(order_id)

    async def _handle_subscription_activated(
        self,
        order_id: str,
        user_id_str: str | None,
        cognito_sub: str | None,
    ) -> None:
        user = None
        if user_id_str:
            try:
                user = await self._user_dao.get_by_id(
                    uuid_mod.UUID(user_id_str)
                )
            except ValueError:
                pass
        if not user and cognito_sub:
            user = await self._user_dao.get_by_cognito_sub(cognito_sub)
        if not user:
            logger.error(
                "AllPay webhook: could not find user for order %s", order_id
            )
            return

        now = datetime.now(timezone.utc)
        period_end = now + timedelta(days=30)

        existing = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, order_id
        )
        if existing:
            await self._subscription_dao.update(
                existing,
                status="active",
                current_period_start=now,
                current_period_end=period_end,
            )
        else:
            await self._subscription_dao.create(
                user_id=user.id,
                provider=PROVIDER.value,
                external_subscription_id=order_id,
                external_customer_id=str(user.id),
                status="active",
                plan_type="monthly",
                current_period_start=now,
                current_period_end=period_end,
            )

        await self._telegram.send_event(
            f"<b>New AllPay subscription</b>\n"
            f"Email: {user.email}\n"
            f"Plan: monthly"
        )

    async def _handle_subscription_canceled(self, order_id: str) -> None:
        sub = await self._subscription_dao.get_by_external_id(
            PROVIDER.value, order_id
        )
        if not sub:
            logger.warning(
                "AllPay webhook: subscription not found: %s", order_id
            )
            return

        await self._subscription_dao.update(
            sub, status="canceled", canceled_at=datetime.now(timezone.utc)
        )

        user = await self._user_dao.get_by_id(sub.user_id)
        await self._telegram.send_event(
            f"<b>AllPay subscription canceled</b>\n"
            f"Email: {user.email if user else 'unknown'}"
        )
