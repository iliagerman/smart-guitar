"""Unified payment provider protocol.

Both AllPayProvider and PaddleProvider implement this protocol so the
router and dependency layer can treat them interchangeably.
"""

from __future__ import annotations

from typing import Protocol

from fastapi import Request

from guitar_player.schemas.subscription import (
    CancelSubscriptionResponse,
    CheckoutResponse,
    PricesResponse,
    SubscriptionStatusResponse,
)


class PaymentProviderProtocol(Protocol):
    async def get_status(
        self, user_sub: str, user_email: str
    ) -> SubscriptionStatusResponse: ...

    async def get_prices(self) -> PricesResponse: ...

    async def create_checkout(
        self, user_sub: str, user_email: str, plan_type: str
    ) -> CheckoutResponse: ...

    async def cancel_subscription(
        self, user_sub: str, user_email: str
    ) -> CancelSubscriptionResponse: ...

    async def handle_webhook(self, request: Request) -> None: ...
