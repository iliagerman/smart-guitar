"""Unit tests for AllPayProvider and the _allpay_sign helper."""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from guitar_player.config import AllPayConfig, Settings
from guitar_player.enums import PaymentProvider
from guitar_player.services.allpay_provider import AllPayProvider, _allpay_sign


# ── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def allpay_config() -> AllPayConfig:
    return AllPayConfig(
        enabled=True,
        login="test-login",
        api_key="test-api-key",
        api_base="https://allpay.to/app/",
        webhook_url="http://localhost:8002/api/v1/webhooks/allpay",
        success_url="http://localhost:5173/subscription/success",
        currency="USD",
        price_monthly=600,
        price_monthly_display="6.00",
        price_yearly=5000,
        price_yearly_display="50.00",
        test_mode=True,
    )


@pytest.fixture
def mock_settings(allpay_config) -> MagicMock:
    settings = MagicMock(spec=Settings)
    settings.allpay = allpay_config
    return settings


@pytest.fixture
def mock_telegram() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def mock_session() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def mock_user() -> MagicMock:
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = "test@example.com"
    user.cognito_sub = "cognito-sub-123"
    user.trial_ends_at = None
    return user


@pytest.fixture
def mock_user_with_trial() -> MagicMock:
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = "trial@example.com"
    user.cognito_sub = "cognito-sub-trial"
    user.trial_ends_at = datetime.now(timezone.utc) + timedelta(days=7)
    return user


def _mock_http_client(response: httpx.Response):
    """Build a mock httpx.AsyncClient as async context manager."""
    mock_client = AsyncMock()
    mock_client.post.return_value = response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


def _make_response(status_code: int = 200, json_data: dict | None = None) -> httpx.Response:
    import json

    body = json.dumps(json_data or {}).encode()
    return httpx.Response(
        status_code=status_code,
        content=body,
        headers={"content-type": "application/json"},
        request=httpx.Request("POST", "https://allpay.to/app/"),
    )


# ── Tests: _allpay_sign ──────────────────────────────────────────


class TestAllPaySign:
    def test_simple_params(self):
        """Flat params → sorted values joined with colons + api_key."""
        params = {"login": "mylogin", "order_id": "ord-1", "currency": "USD"}
        api_key = "secret"
        sig = _allpay_sign(params, api_key)

        # Sorted keys: currency, login, order_id → values: USD, mylogin, ord-1
        expected_str = "USD:mylogin:ord-1:secret"
        expected = hashlib.sha256(expected_str.encode()).hexdigest()
        assert sig == expected

    def test_sign_key_excluded(self):
        """The 'sign' key must not participate in signature computation."""
        params = {"login": "mylogin", "sign": "old-sig"}
        sig_with = _allpay_sign(params, "key")

        params_without = {"login": "mylogin"}
        sig_without = _allpay_sign(params_without, "key")

        assert sig_with == sig_without

    def test_empty_strings_excluded(self):
        """Empty or whitespace-only string values are excluded."""
        params = {"a": "hello", "b": "", "c": "   "}
        sig = _allpay_sign(params, "key")

        expected_str = "hello:key"
        expected = hashlib.sha256(expected_str.encode()).hexdigest()
        assert sig == expected

    def test_numeric_values(self):
        """Integer and float values are stringified."""
        params = {"amount": 600, "rate": 1.5}
        sig = _allpay_sign(params, "key")

        expected_str = "600:1.5:key"
        expected = hashlib.sha256(expected_str.encode()).hexdigest()
        assert sig == expected

    def test_nested_dict(self):
        """Nested dict values are sorted by sub-key."""
        params = {
            "subscription": {
                "end_type": "1",
                "start_type": "1",
            }
        }
        sig = _allpay_sign(params, "key")

        # Sub-keys sorted: end_type, start_type → values: 1, 1
        expected_str = "1:1:key"
        expected = hashlib.sha256(expected_str.encode()).hexdigest()
        assert sig == expected

    def test_list_of_dicts(self):
        """Array of objects → each object's keys sorted, values collected."""
        params = {
            "items": [
                {"name": "Pro Monthly", "price": "6.00", "qty": "1", "vat": "0"}
            ]
        }
        sig = _allpay_sign(params, "key")

        # Sorted sub-keys: name, price, qty, vat → values: Pro Monthly, 6.00, 1, 0
        expected_str = "Pro Monthly:6.00:1:0:key"
        expected = hashlib.sha256(expected_str.encode()).hexdigest()
        assert sig == expected

    def test_deterministic(self):
        """Same input produces same output."""
        params = {"z": "last", "a": "first", "m": "middle"}
        sig1 = _allpay_sign(params, "key")
        sig2 = _allpay_sign(params, "key")
        assert sig1 == sig2

    def test_full_checkout_params(self):
        """Realistic checkout params produce a valid hex string."""
        params = {
            "login": "test-login",
            "order_id": "abc-123",
            "currency": "USD",
            "lang": "EN",
            "client_email": "user@test.com",
            "success_url": "http://localhost/success",
            "webhook_url": "http://localhost/webhook",
            "add_field_1": "uid|sub",
            "items": [
                {"name": "Smart Guitar Pro Monthly", "price": "6.00", "qty": "1", "vat": "0"}
            ],
            "subscription": {"start_type": "1", "end_type": "1"},
        }
        sig = _allpay_sign(params, "test-api-key")
        assert len(sig) == 64  # SHA256 hex digest
        assert all(c in "0123456789abcdef" for c in sig)


# ── Tests: AllPayProvider.get_prices ──────────────────────────────


class TestGetPrices:
    async def test_returns_monthly_price(self, mock_session, mock_settings, mock_telegram):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)
        result = await provider.get_prices()

        assert result.monthly is not None
        assert result.monthly.id == "allpay_monthly"
        assert result.monthly.amount == "6.00"
        assert result.monthly.currency == "USD"
        assert result.monthly.interval == "month"

    async def test_yearly_is_none(self, mock_session, mock_settings, mock_telegram):
        """Phase 1 — yearly is not yet available."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)
        result = await provider.get_prices()
        assert result.yearly is None


# ── Tests: AllPayProvider.get_status ──────────────────────────────


class TestGetStatus:
    async def test_no_subscription_no_trial(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
            patch.object(provider._subscription_dao, "get_pending_by_user", return_value=None),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is False
        assert result.trial_active is False
        assert result.subscription is None

    async def test_active_trial(
        self, mock_session, mock_settings, mock_telegram, mock_user_with_trial
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        with (
            patch.object(
                provider._user_dao, "get_or_create", return_value=mock_user_with_trial
            ),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
            patch.object(provider._subscription_dao, "get_pending_by_user", return_value=None),
        ):
            result = await provider.get_status("sub-trial", "trial@example.com")

        assert result.has_access is True
        assert result.trial_active is True
        assert result.subscription is None

    async def test_active_subscription(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.provider = PaymentProvider.ALLPAY.value
        mock_sub.plan_type = "monthly"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=25)
        mock_sub.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        # AllPay confirms subscription is still active (status=1)
        response = _make_response(200, {"status": "1"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is True
        assert result.subscription is not None
        assert result.subscription.status == "active"
        assert result.subscription.plan_type == "monthly"


# ── Tests: AllPayProvider.get_status — pending verification ───────


class TestGetStatusPendingVerification:
    """Tests for the _verify_and_activate flow in get_status."""

    async def test_pending_sub_verified_and_activated(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Pending subscription is verified with AllPay and activated."""
        mock_pending = MagicMock()
        mock_pending.status = "pending"
        mock_pending.provider = PaymentProvider.ALLPAY.value
        mock_pending.external_subscription_id = "order-pending-1"
        mock_pending.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        mock_pending.plan_type = "monthly"
        mock_pending.current_period_end = None
        mock_pending.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        # AllPay paymentstatus returns status=1 (paid)
        response = _make_response(200, {"status": "1"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
            patch.object(
                provider._subscription_dao, "get_pending_by_user", return_value=mock_pending
            ),
            patch.object(provider._subscription_dao, "update") as mock_update,
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is True
        assert result.subscription is not None
        # Verify the DAO was called to activate
        mock_update.assert_called_once()
        update_kwargs = mock_update.call_args[1]
        assert update_kwargs["status"] == "active"
        assert update_kwargs["current_period_start"] is not None
        assert update_kwargs["current_period_end"] is not None

        # Verify it hit the paymentstatus API
        call_url = mock_client.post.call_args[0][0]
        assert "paymentstatus" in call_url

    async def test_pending_sub_not_yet_paid(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Pending subscription where AllPay says not yet paid → no access."""
        mock_pending = MagicMock()
        mock_pending.status = "pending"
        mock_pending.external_subscription_id = "order-pending-2"
        mock_pending.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        # AllPay returns status=0 (not yet paid)
        response = _make_response(200, {"status": "0"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
            patch.object(
                provider._subscription_dao, "get_pending_by_user", return_value=mock_pending
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is False
        assert result.subscription is None

    async def test_pending_sub_abandoned_not_checked(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Pending subscription older than 1 hour is skipped (abandoned)."""
        mock_pending = MagicMock()
        mock_pending.status = "pending"
        mock_pending.external_subscription_id = "order-abandoned"
        mock_pending.created_at = datetime.now(timezone.utc) - timedelta(hours=2)

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
            patch.object(
                provider._subscription_dao, "get_pending_by_user", return_value=mock_pending
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
            ) as mock_http_cls,
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is False
        assert result.subscription is None
        # Should NOT have called AllPay API
        mock_http_cls.assert_not_called()

    async def test_pending_sub_allpay_api_error_returns_none(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """AllPay API error during pending check → no access (safe failure)."""
        mock_pending = MagicMock()
        mock_pending.status = "pending"
        mock_pending.external_subscription_id = "order-err"
        mock_pending.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(500, {"error": "internal"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
            patch.object(
                provider._subscription_dao, "get_pending_by_user", return_value=mock_pending
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is False
        assert result.subscription is None


# ── Tests: AllPayProvider.get_status — active subscription check ─


class TestGetStatusActiveCheck:
    """Tests for _check_subscription_still_active in get_status."""

    async def test_active_sub_cancelled_in_allpay(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """AllPay reports status=4 (cancelled) → access revoked."""
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.provider = PaymentProvider.ALLPAY.value
        mock_sub.external_subscription_id = "order-cancelled"
        mock_sub.plan_type = "monthly"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=15)
        mock_sub.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        # AllPay subscriptionstatus returns status=4 (cancelled)
        response = _make_response(200, {"status": "4"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch.object(provider._subscription_dao, "update") as mock_update,
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is False
        assert result.subscription is None

        # Verify DB was updated to canceled
        mock_update.assert_called_once()
        update_kwargs = mock_update.call_args[1]
        assert update_kwargs["status"] == "canceled"
        assert update_kwargs["canceled_at"] is not None

        # Verify it hit the subscriptionstatus API
        call_url = mock_client.post.call_args[0][0]
        assert "subscriptionstatus" in call_url

    async def test_active_sub_confirmed_still_active(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """AllPay reports status=1 (active) → access maintained."""
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.provider = PaymentProvider.ALLPAY.value
        mock_sub.external_subscription_id = "order-active"
        mock_sub.plan_type = "monthly"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=15)
        mock_sub.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"status": "1"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is True
        assert result.subscription is not None
        assert result.subscription.status == "active"

    async def test_active_sub_allpay_error_fails_open(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """AllPay API error → fail open, user keeps access."""
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.provider = PaymentProvider.ALLPAY.value
        mock_sub.external_subscription_id = "order-err"
        mock_sub.plan_type = "monthly"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=15)
        mock_sub.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(500, {"error": "internal"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        # Fail open — user keeps access
        assert result.has_access is True
        assert result.subscription is not None
        assert result.subscription.status == "active"

    async def test_active_sub_non_allpay_provider_not_checked(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Subscription from another provider is not checked with AllPay."""
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.provider = PaymentProvider.PADDLE.value
        mock_sub.plan_type = "monthly"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=15)
        mock_sub.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
            ) as mock_http_cls,
        ):
            result = await provider.get_status("sub-123", "test@example.com")

        assert result.has_access is True
        assert result.subscription is not None
        # Should NOT have called AllPay API for paddle sub
        mock_http_cls.assert_not_called()

    async def test_trial_still_active_after_sub_cancelled(
        self, mock_session, mock_settings, mock_telegram, mock_user_with_trial
    ):
        """User still has trial even if AllPay sub is cancelled."""
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.provider = PaymentProvider.ALLPAY.value
        mock_sub.external_subscription_id = "order-x"
        mock_sub.plan_type = "monthly"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=15)
        mock_sub.canceled_at = None

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        # AllPay says cancelled
        response = _make_response(200, {"status": "4"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(
                provider._user_dao, "get_or_create", return_value=mock_user_with_trial
            ),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch.object(provider._subscription_dao, "update"),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.get_status("sub-trial", "trial@example.com")

        # Sub cancelled but trial still active → has_access True
        assert result.has_access is True
        assert result.trial_active is True
        assert result.subscription is None


# ── Tests: AllPayProvider.create_checkout ─────────────────────────


class TestCreateCheckout:
    async def test_successful_checkout(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"payment_url": "https://allpay.to/pay/abc"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.create_checkout("sub-123", "test@example.com", "monthly")

        assert result.payment_url == "https://allpay.to/pay/abc"
        mock_client.post.assert_called_once()

        # Verify the POST URL
        call_args = mock_client.post.call_args
        assert "getpayment" in call_args[0][0]

    async def test_checkout_includes_sign(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """The request body must include a 'sign' field."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"payment_url": "https://allpay.to/pay/xyz"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            await provider.create_checkout("sub-123", "test@example.com", "monthly")

        body = mock_client.post.call_args[1]["json"]
        assert "sign" in body
        assert len(body["sign"]) == 64

    async def test_checkout_passes_user_info(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """add_field_1 should contain user_id|cognito_sub."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"payment_url": "https://allpay.to/pay/xyz"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            await provider.create_checkout("sub-123", "test@example.com", "monthly")

        body = mock_client.post.call_args[1]["json"]
        assert body["add_field_1"] == f"{mock_user.id}|sub-123"

    async def test_checkout_creates_pending_subscription(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Checkout should store a pending subscription in the DB."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"payment_url": "https://allpay.to/pay/new"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=None
            ),
            patch.object(provider._subscription_dao, "create") as mock_create,
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            await provider.create_checkout("sub-123", "test@example.com", "monthly")

        mock_create.assert_called_once()
        create_kwargs = mock_create.call_args[1]
        assert create_kwargs["user_id"] == mock_user.id
        assert create_kwargs["provider"] == PaymentProvider.ALLPAY.value
        assert create_kwargs["status"] == "pending"
        assert create_kwargs["plan_type"] == "monthly"

    async def test_checkout_skips_pending_if_exists(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Checkout should not duplicate pending sub if one already exists for this order."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"payment_url": "https://allpay.to/pay/dup"})
        mock_client = _mock_http_client(response)

        existing = MagicMock()

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=existing
            ),
            patch.object(provider._subscription_dao, "create") as mock_create,
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            await provider.create_checkout("sub-123", "test@example.com", "monthly")

        # Should NOT create a duplicate
        mock_create.assert_not_called()

    async def test_checkout_no_payment_url_raises(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """AllPay returns success but no payment_url → ValueError."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"error": "some error"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            with pytest.raises(ValueError, match="Failed to create AllPay checkout"):
                await provider.create_checkout("sub-123", "test@example.com", "monthly")

    async def test_checkout_http_error_propagates(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """Non-2xx response from AllPay raises httpx error."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(500, {"error": "internal"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            with pytest.raises(httpx.HTTPStatusError):
                await provider.create_checkout("sub-123", "test@example.com", "monthly")


# ── Tests: AllPayProvider.cancel_subscription ─────────────────────


class TestCancelSubscription:
    async def test_no_active_subscription(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(provider._subscription_dao, "get_active_by_user", return_value=None),
        ):
            result = await provider.cancel_subscription("sub-123", "test@example.com")

        assert "No active subscription" in result.message

    async def test_wrong_provider_subscription(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """If subscription belongs to paddle, don't cancel via AllPay."""
        mock_sub = MagicMock()
        mock_sub.provider = PaymentProvider.PADDLE.value
        mock_sub.status = "active"

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
        ):
            result = await provider.cancel_subscription("sub-123", "test@example.com")

        assert "No active subscription" in result.message

    async def test_successful_cancellation(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        mock_sub = MagicMock()
        mock_sub.provider = PaymentProvider.ALLPAY.value
        mock_sub.external_subscription_id = "order-abc"
        mock_sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=15)

        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        response = _make_response(200, {"status": "ok"})
        mock_client = _mock_http_client(response)

        with (
            patch.object(provider._user_dao, "get_or_create", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_active_by_user", return_value=mock_sub
            ),
            patch.object(provider._subscription_dao, "update") as mock_update,
            patch(
                "guitar_player.services.allpay_provider.httpx.AsyncClient",
                return_value=mock_client,
            ),
        ):
            result = await provider.cancel_subscription("sub-123", "test@example.com")

        assert result.message == "Subscription canceled."
        mock_update.assert_called_once()
        update_kwargs = mock_update.call_args[1]
        assert update_kwargs["status"] == "canceled"
        assert update_kwargs["canceled_at"] is not None

        # Verify AllPay cancelsubscription API was called
        call_args = mock_client.post.call_args
        assert "cancelsubscription" in call_args[0][0]


# ── Tests: AllPayProvider.handle_webhook ──────────────────────────


class TestHandleWebhook:
    def _make_request(self, payload: dict, content_type: str = "application/json") -> MagicMock:
        """Build a mock FastAPI Request."""
        request = MagicMock()
        request.headers = {"content-type": content_type}
        request.json = AsyncMock(return_value=payload)
        request.form = AsyncMock(return_value=payload)
        return request

    async def test_valid_webhook_creates_subscription(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        order_id = "order-webhook-1"
        payload = {
            "status": "1",
            "order_id": order_id,
            "add_field_1": f"{mock_user.id}|cognito-sub-123",
        }
        # Compute valid signature
        payload["sign"] = _allpay_sign(payload, "test-api-key")

        request = self._make_request(payload)

        with (
            patch.object(provider._user_dao, "get_by_id", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=None
            ),
            patch.object(provider._subscription_dao, "create") as mock_create,
        ):
            await provider.handle_webhook(request)

        mock_create.assert_called_once()
        create_kwargs = mock_create.call_args[1]
        assert create_kwargs["provider"] == PaymentProvider.ALLPAY.value
        assert create_kwargs["external_subscription_id"] == order_id
        assert create_kwargs["status"] == "active"
        assert create_kwargs["plan_type"] == "monthly"

    async def test_valid_webhook_updates_existing_subscription(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        existing_sub = MagicMock()
        order_id = "order-existing"
        payload = {
            "status": "1",
            "order_id": order_id,
            "add_field_1": f"{mock_user.id}|cognito-sub-123",
        }
        payload["sign"] = _allpay_sign(payload, "test-api-key")

        request = self._make_request(payload)

        with (
            patch.object(provider._user_dao, "get_by_id", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=existing_sub
            ),
            patch.object(provider._subscription_dao, "update") as mock_update,
        ):
            await provider.handle_webhook(request)

        mock_update.assert_called_once()
        update_kwargs = mock_update.call_args[1]
        assert update_kwargs["status"] == "active"

    async def test_invalid_signature_raises(
        self, mock_session, mock_settings, mock_telegram
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        payload = {
            "status": "1",
            "order_id": "order-bad-sig",
            "add_field_1": "uid|sub",
            "sign": "invalid-signature",
        }

        request = self._make_request(payload)

        with pytest.raises(ValueError, match="Invalid AllPay webhook signature"):
            await provider.handle_webhook(request)

    async def test_cancellation_webhook(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        existing_sub = MagicMock()
        existing_sub.user_id = mock_user.id

        payload = {
            "status": "4",
            "order_id": "order-cancel",
            "add_field_1": f"{mock_user.id}|sub",
        }
        payload["sign"] = _allpay_sign(payload, "test-api-key")

        request = self._make_request(payload)

        with (
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=existing_sub
            ),
            patch.object(provider._subscription_dao, "update") as mock_update,
            patch.object(provider._user_dao, "get_by_id", return_value=mock_user),
        ):
            await provider.handle_webhook(request)

        mock_update.assert_called_once()
        update_kwargs = mock_update.call_args[1]
        assert update_kwargs["status"] == "canceled"

    async def test_webhook_unknown_user_logs_and_returns(
        self, mock_session, mock_settings, mock_telegram
    ):
        """Webhook with unresolvable user ID should not crash."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        payload = {
            "status": "1",
            "order_id": "order-no-user",
            "add_field_1": "bad-uuid|bad-sub",
        }
        payload["sign"] = _allpay_sign(payload, "test-api-key")

        request = self._make_request(payload)

        with (
            patch.object(provider._user_dao, "get_by_id", return_value=None),
            patch.object(provider._user_dao, "get_by_cognito_sub", return_value=None),
            patch.object(provider._subscription_dao, "create") as mock_create,
        ):
            # Should not raise
            await provider.handle_webhook(request)

        mock_create.assert_not_called()

    async def test_webhook_sends_telegram_notification(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        payload = {
            "status": "1",
            "order_id": "order-notif",
            "add_field_1": f"{mock_user.id}|sub-123",
        }
        payload["sign"] = _allpay_sign(payload, "test-api-key")

        request = self._make_request(payload)

        with (
            patch.object(provider._user_dao, "get_by_id", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=None
            ),
            patch.object(provider._subscription_dao, "create"),
        ):
            await provider.handle_webhook(request)

        mock_telegram.send_event.assert_called_once()
        msg = mock_telegram.send_event.call_args[0][0]
        assert "AllPay" in msg
        assert mock_user.email in msg

    async def test_form_encoded_webhook(
        self, mock_session, mock_settings, mock_telegram, mock_user
    ):
        """AllPay may POST as form-encoded instead of JSON."""
        provider = AllPayProvider(mock_session, mock_settings, mock_telegram)

        payload = {
            "status": "1",
            "order_id": "order-form",
            "add_field_1": f"{mock_user.id}|sub-123",
        }
        payload["sign"] = _allpay_sign(payload, "test-api-key")

        request = self._make_request(payload, content_type="application/x-www-form-urlencoded")

        with (
            patch.object(provider._user_dao, "get_by_id", return_value=mock_user),
            patch.object(
                provider._subscription_dao, "get_by_external_id", return_value=None
            ),
            patch.object(provider._subscription_dao, "create") as mock_create,
        ):
            await provider.handle_webhook(request)

        mock_create.assert_called_once()
