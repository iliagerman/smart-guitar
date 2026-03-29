"""Subscription request/response schemas.

These schemas are provider-agnostic — the frontend has no knowledge of
which payment provider (Paddle, AllPay, etc.) is active.
"""

from datetime import datetime

from pydantic import BaseModel


class SubscriptionDetail(BaseModel):
    status: str
    plan_type: str
    current_period_end: datetime | None = None
    canceled_at: datetime | None = None

    model_config = {"from_attributes": True}


class SubscriptionStatusResponse(BaseModel):
    """Returned by GET /api/v1/subscription/status."""

    has_access: bool
    trial_ends_at: datetime | None = None
    trial_active: bool = False
    subscription: SubscriptionDetail | None = None
    has_seen_onboarding: bool = False
    is_admin: bool = False
    onboarding_song_id: str | None = None


class PriceDetail(BaseModel):
    id: str
    name: str
    amount: str
    currency: str
    interval: str


class PricesResponse(BaseModel):
    monthly: PriceDetail | None = None
    yearly: PriceDetail | None = None


class CheckoutRequest(BaseModel):
    plan_type: str = "monthly"


class CheckoutResponse(BaseModel):
    payment_url: str


class CancelSubscriptionResponse(BaseModel):
    message: str
    effective_date: datetime | None = None


class OkResponse(BaseModel):
    """Simple success response for endpoints that return {"ok": true}."""

    ok: bool = True


class WebhookOkResponse(BaseModel):
    """Response for webhook endpoints (maintains backward-compatible shape)."""

    status: str = "ok"
