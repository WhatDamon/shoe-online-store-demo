"""Payment-session outcomes against the shared fake Stripe gateway.

All four ``payments/session`` codes are machine-readable HTTP 200 outcomes, so every
assertion below compares the whole response body. Every outbound call goes to the fake
gateway defined in ``conftest.py``: no test in this file performs network access.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
import stripe
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.application import payments
from app.application.payments import checkout_expires_at
from app.config import settings
from app.domain.models import Order, OrderItem, Payment, PaymentEvent
from app.infrastructure.stripe_gateway import SdkStripeGateway

DISABLED_MESSAGE = "Payments are not available yet."
READY_MESSAGE = "Complete your payment to confirm this order."
NOT_PAYABLE_MESSAGE = "This order can no longer be paid. Please start a new order."
CURRENCY_MESSAGE = "This store cannot charge in this currency."


def place_order(client, variant, key="payments-session", quantity=1):
    client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": quantity})
    response = client.post("/api/v1/checkout/create-order", headers={"Idempotency-Key": key})
    assert response.status_code == 200
    return response.json()


def session_post(client, order_id, **kwargs):
    return client.post("/api/v1/payments/session", json={"order_id": order_id}, **kwargs)


def update_order(engine, order_id, **values):
    with Session(engine) as db, db.begin():
        db.execute(update(Order).where(Order.id == order_id).values(**values))


def update_items(engine, order_id, **values):
    with Session(engine) as db, db.begin():
        db.execute(update(OrderItem).where(OrderItem.order_id == order_id).values(**values))


def row_count(engine, model):
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(model))


def assert_no_payment_rows(engine, order_id):
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        assert payment is None
        assert db.scalar(select(func.count()).select_from(PaymentEvent)) == 0


def assert_no_gateway_calls(fake_gateway):
    assert fake_gateway.created == []
    assert fake_gateway.retrieved == []


@pytest.fixture
def payable_order(commerce, variant, monkeypatch):
    """An order whose reservation outlives Stripe's 30-minute minimum window."""
    client, _ = commerce
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 3600)
    return place_order(client, variant)


@pytest.fixture
def stripe_checkout(monkeypatch, fake_gateway):
    """Enable Stripe and route the outbound seam to the recording fake gateway."""
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_payment_session")
    monkeypatch.setattr(payments, "default_gateway", lambda: fake_gateway)
    return fake_gateway


def test_disabled_provider_keeps_machine_readable_disabled_result(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    response = session_post(client, order["id"])
    assert response.status_code == 200
    assert response.json() == {
        "code": "payment_disabled",
        "payment_enabled": False,
        "provider": "mock",
        "order_id": order["id"],
        "order_status": "pending_payment",
        "redirect_url": None,
        "message": DISABLED_MESSAGE,
    }
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order["id"]))
        assert (payment.provider, payment.status) == ("mock", "disabled")
        assert db.scalar(select(func.count()).select_from(PaymentEvent)) == 1
    # The disabled path must never move the order towards fulfilment.
    assert client.get(f"/api/v1/orders/{order['id']}").json()["status"] == "pending_payment"


def test_session_creates_no_stripe_call_when_disabled(commerce, variant, monkeypatch):
    client, _ = commerce
    order = place_order(client, variant)
    built: list[str] = []

    def unexpected_gateway() -> None:
        built.append("gateway")
        raise AssertionError("Stripe must not be reached while payments are disabled")

    monkeypatch.setattr(payments, "default_gateway", unexpected_gateway)
    result = session_post(client, order["id"]).json()
    assert result["code"] == "payment_disabled"
    assert built == []


def test_session_requires_owned_order(commerce, payable_order, stripe_checkout):
    client, _ = commerce
    response = session_post(client, payable_order["id"], headers={"X-Session-ID": str(uuid4())})
    # Ownership failures keep the existing 404: a 409 would reveal the order exists.
    assert response.status_code == 404
    assert response.json()["code"] == "order_not_found"
    assert_no_gateway_calls(stripe_checkout)


def test_session_rejects_expired_order(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    update_order(engine, payable_order["id"], expires_at=datetime.now(UTC) - timedelta(seconds=1))
    response = session_post(client, payable_order["id"])
    assert response.status_code == 200
    assert response.json() == {
        "code": "order_not_payable",
        "payment_enabled": True,
        "provider": "stripe",
        "order_id": payable_order["id"],
        "order_status": "cancelled",
        "redirect_url": None,
        "message": NOT_PAYABLE_MESSAGE,
    }
    assert_no_gateway_calls(stripe_checkout)
    assert_no_payment_rows(engine, payable_order["id"])


def test_session_rejects_order_with_too_little_payable_time_left(
    commerce, payable_order, stripe_checkout
):
    client, engine = commerce
    # Stripe refuses a checkout expiry below 30 minutes; overlapping the reservation with a
    # shorter session would be silently unpayable, so the order is refused instead.
    update_order(engine, payable_order["id"], expires_at=datetime.now(UTC) + timedelta(minutes=29))
    result = session_post(client, payable_order["id"]).json()
    assert (result["code"], result["order_status"]) == ("order_not_payable", "pending_payment")
    assert_no_gateway_calls(stripe_checkout)
    assert_no_payment_rows(engine, payable_order["id"])


def test_session_rejects_already_paid_order(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    update_order(engine, payable_order["id"], status="paid")
    result = session_post(client, payable_order["id"]).json()
    assert (result["code"], result["order_status"]) == ("order_not_payable", "paid")
    assert_no_gateway_calls(stripe_checkout)


@pytest.mark.parametrize("status", ["cancelled", "refunded"])
def test_session_rejects_orders_that_are_no_longer_payable(
    commerce, payable_order, stripe_checkout, status
):
    client, engine = commerce
    update_order(engine, payable_order["id"], status=status)
    result = session_post(client, payable_order["id"]).json()
    assert (result["code"], result["order_status"]) == ("order_not_payable", status)
    assert_no_gateway_calls(stripe_checkout)


def test_session_recomputes_total_and_rejects_mismatch(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    # Stripe is never told an amount the client could have influenced: the order lines are
    # the source, and a row that disagrees with them is rejected before any outbound call.
    update_order(
        engine, payable_order["id"], total=Decimal(payable_order["total"]) + Decimal("0.01")
    )
    result = session_post(client, payable_order["id"]).json()
    assert result["code"] == "order_not_payable"
    assert_no_gateway_calls(stripe_checkout)
    assert_no_payment_rows(engine, payable_order["id"])


def test_session_rejects_non_chargeable_amount(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    update_items(engine, payable_order["id"], unit_price=Decimal("0.01"))
    update_order(engine, payable_order["id"], total=Decimal("0.01"))
    result = session_post(client, payable_order["id"]).json()
    assert result["code"] == "order_not_payable"
    assert_no_gateway_calls(stripe_checkout)
    assert_no_payment_rows(engine, payable_order["id"])


def test_session_rejects_unsupported_currency(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    update_order(engine, payable_order["id"], currency="EUR")
    response = session_post(client, payable_order["id"])
    assert response.status_code == 200
    assert response.json() == {
        "code": "currency_unsupported",
        "payment_enabled": True,
        "provider": "stripe",
        "order_id": payable_order["id"],
        "order_status": "pending_payment",
        "redirect_url": None,
        "message": CURRENCY_MESSAGE,
    }
    assert_no_gateway_calls(stripe_checkout)
    assert_no_payment_rows(engine, payable_order["id"])


def test_session_normalizes_stored_currency_before_charging(
    commerce, payable_order, stripe_checkout
):
    client, engine = commerce
    # Stripe speaks lowercase currency codes; the money constants are uppercase.
    update_order(engine, payable_order["id"], currency="usd")
    result = session_post(client, payable_order["id"]).json()
    assert result["code"] == "payment_ready"
    assert stripe_checkout.created[0]["currency"] == "USD"
    with Session(engine) as db:
        assert db.scalar(
            select(Payment).where(Payment.order_id == payable_order["id"])
        ).currency == ("USD")


def test_session_creates_checkout_session_for_a_payable_order(
    commerce, payable_order, stripe_checkout
):
    client, engine = commerce
    response = session_post(client, payable_order["id"])
    assert response.status_code == 200
    assert response.json() == {
        "code": "payment_ready",
        "payment_enabled": True,
        "provider": "stripe",
        "order_id": payable_order["id"],
        "order_status": "pending_payment",
        "redirect_url": stripe_checkout.url,
        "message": READY_MESSAGE,
    }
    created = stripe_checkout.created[0]
    assert created["order_id"] == payable_order["id"]
    assert created["success_url"].endswith(f"/orders/{payable_order['id']}?payment=success")
    assert created["cancel_url"].endswith(f"/orders/{payable_order['id']}?payment=cancelled")
    assert created["idempotency_key"] == f"checkout-session:{payable_order['id']}"
    # dc-1001 costs 59.00 in the demo catalog, so Stripe is charged 5900 minor units.
    assert created["line_items"] == [
        {"name": payable_order["items"][0]["title"], "unit_amount": 5900, "quantity": 1}
    ]
    assert sum(line["unit_amount"] * line["quantity"] for line in created["line_items"]) == 5900
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == payable_order["id"]))
        assert payment.provider == "stripe"
        assert payment.status == "requires_payment"
        assert payment.provider_reference == stripe_checkout.session_id
        assert payment.amount == Decimal(payable_order["total"])
        assert (payment.currency, payment.created_at is not None) == ("USD", True)
        assert db.scalar(select(func.count()).select_from(PaymentEvent)) == 1
    assert row_count(engine, Payment) == 1


def test_session_reuses_existing_open_session(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    first = session_post(client, payable_order["id"]).json()
    second = session_post(client, payable_order["id"]).json()
    # A second request must hand back the session Stripe already has, not a second one.
    assert first == second
    assert second["redirect_url"] == stripe_checkout.url
    assert len(stripe_checkout.created) == 1
    assert stripe_checkout.retrieved == [stripe_checkout.session_id]
    assert row_count(engine, Payment) == 1


def test_session_opens_a_new_session_when_the_stored_one_is_gone(
    commerce, payable_order, stripe_checkout
):
    client, _ = commerce
    session_post(client, payable_order["id"])
    stripe_checkout.missing = True
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    assert len(stripe_checkout.created) == 2


def test_session_clamps_stripe_expiry_to_reservation_deadline(
    commerce, variant, stripe_checkout, monkeypatch
):
    client, engine = commerce
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 48 * 3600)
    order = place_order(client, variant, key="payments-session-long")
    session_post(client, order["id"])
    sent = stripe_checkout.created[0]["expires_at"]
    with Session(engine) as db:
        deadline = db.get(Order, order["id"]).expires_at.replace(tzinfo=UTC)
    # The reservation outlives Stripe's 24-hour maximum: Stripe gets the cap, and the
    # reservation itself is left untouched.
    assert deadline >= sent + timedelta(hours=23)
    assert datetime.now(UTC) + timedelta(hours=24) - timedelta(seconds=5) <= sent
    assert sent <= datetime.now(UTC) + timedelta(hours=24)
    assert datetime.fromisoformat(order["expires_at"]) == deadline


def test_sdk_gateway_reads_key_and_timeout_from_settings(monkeypatch):
    # The adapter is the only place that touches the SDK: constructing it must read the
    # configured key and timeout and make no outbound call.
    monkeypatch.setattr(stripe, "api_key", stripe.api_key)
    monkeypatch.setattr(stripe, "default_http_client", stripe.default_http_client)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_gateway")
    monkeypatch.setattr(settings, "stripe_api_timeout_seconds", 7)
    SdkStripeGateway()
    assert stripe.api_key == "sk_test_gateway"
    assert stripe.default_http_client is not None
    assert stripe.default_http_client._timeout == 7


def test_checkout_expiry_clamps_both_ends():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    assert checkout_expires_at(now + timedelta(minutes=5), now=now) == now + timedelta(minutes=30)
    assert checkout_expires_at(now + timedelta(hours=48), now=now) == now + timedelta(hours=24)
    inside = now + timedelta(hours=2)
    assert checkout_expires_at(inside, now=now) == inside
