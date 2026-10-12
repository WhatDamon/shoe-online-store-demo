"""Payment/health contract shape.

These tests build the response models directly: they lock the *accepted* vocabulary of the
wire contract (order statuses, payment codes, redirect_url rules) independently of whether
any provider can currently produce those values. Provider behaviour is not covered here.
"""

import pytest
from pydantic import ValidationError

from app.config import settings
from app.schemas.responses import OrderResponse, PaymentResponse


def order_payload(**overrides):
    return {
        "id": "order-1",
        "status": "pending_payment",
        "expires_at": None,
        "cancellation_reason": None,
        "total": "118.00",
        "currency": "USD",
        "payment_enabled": False,
        "message": "Payments are not available yet.",
        "items": [],
    } | overrides


def payment_payload(**overrides):
    return {
        "code": "payment_disabled",
        "payment_enabled": False,
        "provider": "mock",
        "order_id": "order-1",
        "order_status": "pending_payment",
        "message": "Payments are not available yet.",
    } | overrides


@pytest.mark.parametrize("status", ["paid", "refunded"])
def test_order_response_accepts_paid_and_refunded(status):
    assert OrderResponse(**order_payload(status=status)).status == status


def test_order_response_rejects_unknown_status():
    with pytest.raises(ValidationError):
        OrderResponse(**order_payload(status="shipped"))


def test_health_reports_payment_enabled_from_stripe_ready(commerce, monkeypatch):
    client, _ = commerce
    assert client.get("/health").json()["payment_enabled"] is False
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_contract")
    assert client.get("/health").json()["payment_enabled"] is True


def test_payment_response_accepts_stripe_provider():
    assert PaymentResponse(**payment_payload(provider="stripe")).provider == "stripe"


def test_payment_response_no_longer_carries_charged():
    assert "charged" not in PaymentResponse.model_fields


def test_payment_response_requires_redirect_url_when_ready():
    ready = payment_payload(code="payment_ready", payment_enabled=True)
    with pytest.raises(ValidationError, match="redirect_url"):
        PaymentResponse(**ready)
    url = "https://checkout.stripe.com/c/pay/cs_test_contract"
    assert PaymentResponse(**ready, redirect_url=url).redirect_url == url


@pytest.mark.parametrize("code", ["payment_disabled", "order_not_payable", "currency_unsupported"])
def test_payment_response_forbids_redirect_url_without_a_ready_session(code):
    with pytest.raises(ValidationError, match="redirect_url"):
        PaymentResponse(
            **payment_payload(code=code, redirect_url="https://checkout.stripe.com/c/pay/leftover")
        )
