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
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.application import payments
from app.application.payments import MIN_CHECKOUT_WINDOW, checkout_expires_at
from app.config import Settings, settings
from app.domain.models import Inventory, Order, OrderItem, Payment, PaymentEvent, Reservation
from app.infrastructure.stripe_gateway import SdkStripeGateway
from tests.conftest import place_order, session_post, update_order

DISABLED_MESSAGE = "Payments are not available yet."
READY_MESSAGE = "Complete your payment to confirm this order."
NOT_PAYABLE_MESSAGE = "This order can no longer be paid. Please start a new order."
CURRENCY_MESSAGE = "This store cannot charge in this currency."


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
    # A refund is the other outbound call this suite can trigger; leaving it unchecked
    # would let a refund-path test pass while Stripe was actually reached.
    assert fake_gateway.refunds == []


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


def test_default_reservation_window_outlives_the_stripe_minimum_window():
    """The shipped configuration must be able to open a session at all (P0-①).

    Pinned against ``MIN_CHECKOUT_WINDOW`` rather than a number: whenever Stripe's minimum
    moves, this is the pair that has to move with it. A shorter default would hold stock
    for less time than a checkout session needs, so every order this store created would be
    refused by its own payable check.
    """
    configured = Settings(_env_file=None).reservation_ttl_seconds
    assert configured > MIN_CHECKOUT_WINDOW.total_seconds()


def test_a_reservation_shorter_than_the_checkout_window_is_refused():
    # The floor is the operator-facing half of the same fix: a deployment cannot configure
    # a deadline that makes its own orders unpayable.
    with pytest.raises(ValidationError):
        Settings(reservation_ttl_seconds=int(MIN_CHECKOUT_WINDOW.total_seconds()), _env_file=None)


def test_the_default_reservation_window_can_be_paid_end_to_end(
    commerce, variant, stripe_checkout, proxy_credential
):
    """The ordinary flow, under the real default deadline (P0-①).

    Nothing here monkeypatches ``reservation_ttl_seconds``: add to cart, create the order,
    open the checkout session, deliver Stripe's completion. Before the default was raised
    above Stripe's 30-minute minimum this test failed at the session request, which answered
    ``order_not_payable`` for every order the service created.
    """
    client, engine = commerce
    order = place_order(client, variant)

    session = session_post(client, order["id"])

    assert session.json()["code"] == "payment_ready"
    assert stripe_checkout.created[0]["order_id"] == order["id"]
    with Session(engine) as db:
        deadline = db.get(Order, order["id"]).expires_at.replace(tzinfo=UTC)
        total_minor = int(db.get(Order, order["id"]).total * 100)
    assert deadline - datetime.now(UTC) > MIN_CHECKOUT_WINDOW

    delivered = client.post(
        "/api/v1/webhooks/stripe",
        headers=proxy_credential,
        json={
            "id": "evt_default_window",
            "type": "checkout.session.completed",
            "order_id": order["id"],
            "checkout_session_id": stripe_checkout.session_id,
            "payment_intent": "pi_test_default_window",
            "amount_total": total_minor,
            "currency": "usd",
        },
    )

    assert delivered.status_code == 200
    assert delivered.json()["status"] == "processed"
    body = client.get(f"/api/v1/orders/{order['id']}").json()
    assert (body["status"], body["payment_status"]) == ("paid", "succeeded")
    with Session(engine) as db:
        holds = db.scalars(select(Reservation.status).where(Reservation.order_id == order["id"]))
        assert list(holds) == ["consumed"]
        # The hold became a sale: the unit stays out of available and stops being reserved.
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (9, 0)


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


def test_session_gateway_failure_returns_500_without_persisting_payment(
    commerce, payable_order, failing_gateway, monkeypatch
):
    client, engine = commerce
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_gateway_failure")
    monkeypatch.setattr(payments, "default_gateway", lambda: failing_gateway)
    response = session_post(client, payable_order["id"])
    # A failing Stripe call is an infrastructure error, not a payment outcome: the Next
    # proxy maps the 5xx onto backend_unavailable, and the attempt stays retryable.
    assert response.status_code == 500
    assert response.json() == {
        "code": "internal_error",
        "detail": "Request could not be completed",
    }
    assert failing_gateway.calls == ["create_checkout_session"]
    # The payment row is written inside the request transaction, which rolls back here:
    # no payment or event row may survive to look like a session Stripe never opened.
    assert_no_payment_rows(engine, payable_order["id"])
    assert row_count(engine, Payment) == 0


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
