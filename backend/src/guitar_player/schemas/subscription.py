"""Subscription request/response schemas.

These schemas are provider-agnostic — the frontend has no knowledge of
which payment provider (Paddle, AllPay, etc.) is active.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SubscriptionDetail(BaseModel):
    status: str
    plan_type: str
    current_period_end: Optional[datetime] = None
    canceled_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SubscriptionStatusResponse(BaseModel):
    """Returned by GET /api/v1/subscription/status."""

    has_access: bool
    trial_ends_at: Optional[datetime] = None
    trial_active: bool = False
    subscription: Optional[SubscriptionDetail] = None


class PriceDetail(BaseModel):
    id: str
    name: str
    amount: str
    currency: str
    interval: str


class PricesResponse(BaseModel):
    monthly: Optional[PriceDetail] = None
    yearly: Optional[PriceDetail] = None


class CheckoutRequest(BaseModel):
    plan_type: str = "monthly"


class CheckoutResponse(BaseModel):
    payment_url: str


class CancelSubscriptionResponse(BaseModel):
    message: str
    effective_date: Optional[datetime] = None
