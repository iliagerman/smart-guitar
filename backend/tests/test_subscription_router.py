"""Integration tests for subscription router endpoints.

Uses FastAPI TestClient with dependency overrides to test the
provider-agnostic subscription router.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.dependencies import get_payment_provider, get_telegram_service
from guitar_player.routers.subscription import router, webhook_router
from guitar_player.schemas.subscription import (
    CancelSubscriptionResponse,
    CheckoutResponse,
    PriceDetail,
    PricesResponse,
    SubscriptionDetail,
    SubscriptionStatusResponse,
)


# ── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def mock_provider() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def mock_telegram() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def current_user() -> CurrentUser:
    return CurrentUser(sub="test-sub-123", email="test@example.com")


@pytest.fixture
def client(mock_provider, mock_telegram, current_user) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.include_router(webhook_router, prefix="/api/v1")

    app.dependency_overrides[get_current_user] = lambda: current_user
    app.dependency_overrides[get_payment_provider] = lambda: mock_provider
    app.dependency_overrides[get_telegram_service] = lambda: mock_telegram

    return TestClient(app)


# ── Tests: GET /subscription/status ───────────────────────────────


class TestGetStatus:
    def test_returns_status(self, client, mock_provider):
        mock_provider.get_status.return_value = SubscriptionStatusResponse(
            has_access=True,
            trial_ends_at=datetime.now(timezone.utc) + timedelta(days=7),
            trial_active=True,
        )

        resp = client.get("/api/v1/subscription/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_access"] is True
        assert data["trial_active"] is True
        assert data["subscription"] is None

    def test_with_active_subscription(self, client, mock_provider):
        period_end = datetime.now(timezone.utc) + timedelta(days=25)
        mock_provider.get_status.return_value = SubscriptionStatusResponse(
            has_access=True,
            trial_active=False,
            subscription=SubscriptionDetail(
                status="active",
                plan_type="monthly",
                current_period_end=period_end,
            ),
        )

        resp = client.get("/api/v1/subscription/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_access"] is True
        assert data["subscription"]["status"] == "active"
        assert data["subscription"]["plan_type"] == "monthly"

    def test_no_access(self, client, mock_provider):
        mock_provider.get_status.return_value = SubscriptionStatusResponse(
            has_access=False,
            trial_active=False,
        )

        resp = client.get("/api/v1/subscription/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_access"] is False


# ── Tests: GET /subscription/prices ───────────────────────────────


class TestGetPrices:
    def test_returns_prices(self, client, mock_provider):
        mock_provider.get_prices.return_value = PricesResponse(
            monthly=PriceDetail(
                id="allpay_monthly",
                name="Smart Guitar Pro",
                amount="6.00",
                currency="USD",
                interval="month",
            ),
            yearly=None,
        )

        resp = client.get("/api/v1/subscription/prices")
        assert resp.status_code == 200
        data = resp.json()
        assert data["monthly"]["amount"] == "6.00"
        assert data["monthly"]["interval"] == "month"
        assert data["yearly"] is None

    def test_with_yearly_price(self, client, mock_provider):
        mock_provider.get_prices.return_value = PricesResponse(
            monthly=PriceDetail(
                id="monthly", name="Monthly", amount="6.00", currency="USD", interval="month"
            ),
            yearly=PriceDetail(
                id="yearly", name="Yearly", amount="50.00", currency="USD", interval="year"
            ),
        )

        resp = client.get("/api/v1/subscription/prices")
        assert resp.status_code == 200
        data = resp.json()
        assert data["yearly"]["amount"] == "50.00"


# ── Tests: POST /subscription/checkout ────────────────────────────


class TestCreateCheckout:
    def test_monthly_checkout(self, client, mock_provider):
        mock_provider.create_checkout.return_value = CheckoutResponse(
            payment_url="https://allpay.to/pay/session-abc"
        )

        resp = client.post(
            "/api/v1/subscription/checkout",
            json={"plan_type": "monthly"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["payment_url"] == "https://allpay.to/pay/session-abc"

        mock_provider.create_checkout.assert_called_once_with(
            "test-sub-123", "test@example.com", "monthly"
        )

    def test_yearly_checkout(self, client, mock_provider):
        mock_provider.create_checkout.return_value = CheckoutResponse(
            payment_url="https://allpay.to/pay/yearly-xyz"
        )

        resp = client.post(
            "/api/v1/subscription/checkout",
            json={"plan_type": "yearly"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["payment_url"] == "https://allpay.to/pay/yearly-xyz"

    def test_invalid_plan_type(self, client, mock_provider):
        resp = client.post(
            "/api/v1/subscription/checkout",
            json={"plan_type": "invalid"},
        )
        assert resp.status_code == 400
        assert "plan_type must be monthly or yearly" in resp.json()["detail"]
        mock_provider.create_checkout.assert_not_called()

    def test_default_plan_type_is_monthly(self, client, mock_provider):
        mock_provider.create_checkout.return_value = CheckoutResponse(
            payment_url="https://allpay.to/pay/default"
        )

        resp = client.post("/api/v1/subscription/checkout", json={})
        assert resp.status_code == 200
        mock_provider.create_checkout.assert_called_once_with(
            "test-sub-123", "test@example.com", "monthly"
        )


# ── Tests: POST /subscription/cancel ─────────────────────────────


class TestCancelSubscription:
    def test_cancel_active(self, client, mock_provider):
        effective = datetime.now(timezone.utc) + timedelta(days=15)
        mock_provider.cancel_subscription.return_value = CancelSubscriptionResponse(
            message="Subscription canceled.",
            effective_date=effective,
        )

        resp = client.post("/api/v1/subscription/cancel")
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "Subscription canceled."
        assert data["effective_date"] is not None

    def test_cancel_no_subscription(self, client, mock_provider):
        mock_provider.cancel_subscription.return_value = CancelSubscriptionResponse(
            message="No active subscription found."
        )

        resp = client.post("/api/v1/subscription/cancel")
        assert resp.status_code == 200
        data = resp.json()
        assert "No active subscription" in data["message"]


# ── Tests: POST /webhooks/payment ─────────────────────────────────


class TestPaymentWebhook:
    def test_successful_webhook(self, client, mock_provider):
        mock_provider.handle_webhook.return_value = None

        resp = client.post(
            "/api/v1/webhooks/payment",
            json={"status": "1", "order_id": "ord-1", "sign": "abc"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        mock_provider.handle_webhook.assert_called_once()

    def test_invalid_signature_returns_403(self, client, mock_provider):
        mock_provider.handle_webhook.side_effect = ValueError("Invalid signature")

        resp = client.post(
            "/api/v1/webhooks/payment",
            json={"status": "1", "order_id": "ord-1", "sign": "bad"},
        )
        assert resp.status_code == 403
        assert "Invalid signature" in resp.json()["detail"]

    def test_unexpected_error_returns_200(self, client, mock_provider, mock_telegram):
        """App-level errors return 200 to prevent provider retries."""
        mock_provider.handle_webhook.side_effect = RuntimeError("DB error")

        resp = client.post(
            "/api/v1/webhooks/payment",
            json={"status": "1", "order_id": "ord-1", "sign": "abc"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        mock_telegram.send_error.assert_called_once()


# ── Tests: Provider-agnostic behavior ─────────────────────────────


class TestProviderAgnostic:
    def test_no_provider_fields_in_status_response(self, client, mock_provider):
        """Status response must not contain provider-specific fields."""
        mock_provider.get_status.return_value = SubscriptionStatusResponse(
            has_access=True,
            trial_active=False,
            subscription=SubscriptionDetail(
                status="active",
                plan_type="monthly",
            ),
        )

        resp = client.get("/api/v1/subscription/status")
        data = resp.json()

        # Should NOT have provider-specific fields
        assert "paddle_subscription_id" not in data
        assert "provider" not in data
        sub = data["subscription"]
        assert "paddle_subscription_id" not in sub
        assert "provider" not in sub

    def test_checkout_response_is_just_payment_url(self, client, mock_provider):
        """Checkout response must only contain payment_url, nothing else."""
        mock_provider.create_checkout.return_value = CheckoutResponse(
            payment_url="https://pay.example.com/checkout"
        )

        resp = client.post(
            "/api/v1/subscription/checkout",
            json={"plan_type": "monthly"},
        )
        data = resp.json()
        assert list(data.keys()) == ["payment_url"]
