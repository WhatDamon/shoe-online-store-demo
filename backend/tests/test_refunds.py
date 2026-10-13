"""Refunds: captured money leaves through one idempotent path, or stays owed.

The refund is the counterpart of the release guard, and it is the only path that moves a
``succeeded`` payment to ``refunded``. One attempt either moves both axes together
(``payments.status='refunded'`` and ``orders.status='refunded'``) or leaves the money at
``refund_pending`` with the attempt recorded; stock never goes back on sale either way.
Every attempt reaches Stripe through the same deterministic idempotency key, so re-running
the request or the compensation command cannot refund twice.

Every outbound call goes to the fake gateways defined in ``conftest.py``: no test in this
file performs network access.
"""

from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.application import payments
from app.application.payments import refund_attempts, refund_pending_payments
from app.config import settings
from app.domain.models import AuditLog, Inventory, Order, Payment, PaymentEvent, Reservation
from tests.conftest import session_post

# dc-1001's first variant holds this many sellable units in the seeded catalog.
SEEDED_AVAILABLE = 10
NOT_REFUNDABLE = "This payment cannot be refunded"
REFUND_FAILED = "The refund could not be completed"


def refund(client, order_id, **kwargs):
    return client.post(f"/api/v1/orders/{order_id}/refund", **kwargs)


def order_state(engine, order_id):
    with Session(engine) as db:
        order = db.get(Order, order_id)
        return dict(status=order.status, refunded_at=order.refunded_at)


def money_state(engine, order_id):
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        if payment is None:
            return None
        return dict(
            id=payment.id,
            status=payment.status,
            reference=payment.provider_reference,
            payment_intent=payment.payment_intent,
            refunded_at=payment.refunded_at,
        )


def set_money(engine, order_id, **values):
    with Session(engine) as db, db.begin():
        db.execute(update(Payment).where(Payment.order_id == order_id).values(**values))


def event_names(engine, order_id):
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        return sorted(
            db.scalars(select(PaymentEvent.event).where(PaymentEvent.payment_id == payment.id))
        )


def audit_actions(engine, entity_id):
    with Session(engine) as db:
        return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id)))


def stock_levels(engine, variant_id):
    with Session(engine) as db:
        stock = db.get(Inventory, variant_id)
        return (stock.available, stock.reserved)


def reservation_statuses(engine, order_id):
    with Session(engine) as db:
        return list(db.scalars(select(Reservation.status).where(Reservation.order_id == order_id)))


def attempts_of(engine, order_id):
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        return refund_attempts(db, payment.id)


def run_compensation_pass(engine, gateway):
    """Run the pass the way the CLI does: its own transaction, its own error."""
    with Session(engine) as db, db.begin():
        return refund_pending_payments(db, gateway=gateway)


def test_refund_requires_a_session_that_owns_the_order(commerce, paid_order, stripe_checkout):
    client, engine = commerce
    response = refund(client, paid_order["id"], headers={"X-Session-ID": str(uuid4())})

    # A 409 would reveal that another session's order exists, so ownership stays a 404.
    assert response.status_code == 404
    assert response.json() == {"code": "order_not_found", "detail": "Order not found"}
    assert stripe_checkout.refunds == []
    assert money_state(engine, paid_order["id"])["status"] == "succeeded"
    assert order_state(engine, paid_order["id"])["status"] == "paid"


def test_refund_rejects_an_order_with_no_captured_money(commerce, payable_order, stripe_checkout):
    client, engine = commerce
    # Stripe was never asked for a session, so no money row exists at all.
    response = refund(client, payable_order["id"])

    assert response.status_code == 409
    assert response.json() == {"code": "payment_not_refundable", "detail": NOT_REFUNDABLE}
    assert stripe_checkout.refunds == []
    assert money_state(engine, payable_order["id"]) is None


def test_refund_rejects_an_order_whose_payment_never_succeeded(
    commerce, payable_order, stripe_checkout
):
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"

    response = refund(client, payable_order["id"])

    assert response.status_code == 409
    assert response.json() == {"code": "payment_not_refundable", "detail": NOT_REFUNDABLE}
    assert money_state(engine, payable_order["id"])["status"] == "requires_payment"
    assert stripe_checkout.refunds == []


def test_refund_is_refused_before_any_outbound_call_while_payments_are_disabled(
    commerce, paid_order, stripe_checkout, monkeypatch
):
    client, engine = commerce
    monkeypatch.setattr(settings, "stripe_enabled", False)

    response = refund(client, paid_order["id"])

    # A disabled store must not construct a gateway that would call Stripe with no key.
    assert response.status_code == 409
    assert response.json() == {"code": "payment_not_refundable", "detail": NOT_REFUNDABLE}
    assert stripe_checkout.refunds == []
    assert money_state(engine, paid_order["id"])["status"] == "succeeded"


def test_refund_marks_the_order_and_the_payment_refunded(
    commerce, variant, paid_order, stripe_checkout
):
    client, engine = commerce
    response = refund(client, paid_order["id"])

    assert response.status_code == 200
    assert response.json()["status"] == "refunded"
    state = order_state(engine, paid_order["id"])
    assert (state["status"], state["refunded_at"] is not None) == ("refunded", True)
    money = money_state(engine, paid_order["id"])
    assert (money["status"], money["refunded_at"] is not None) == ("refunded", True)
    assert event_names(engine, paid_order["id"]) == [
        "payment_session_created",
        "payment_succeeded",
        "refund_succeeded",
    ]
    assert "refund_succeeded" in audit_actions(engine, paid_order["id"])
    # A refund is a money event, never a stock event: nothing goes back on sale here.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, paid_order["id"]) == ["consumed"]


def test_refund_uses_a_deterministic_key_derived_from_the_order(
    commerce, paid_order, stripe_checkout
):
    client, _ = commerce
    assert refund(client, paid_order["id"]).status_code == 200

    # Stripe deduplicates on this key, so a repeated attempt can never refund twice, and
    # the key is derivable from the order alone: no stored secret, no random suffix.
    assert stripe_checkout.refunds == [
        {"payment_intent": "pi_test_paid", "idempotency_key": f"refund:{paid_order['id']}"}
    ]


def test_refund_is_idempotent_on_repeat_delivery(commerce, paid_order, stripe_checkout):
    client, engine = commerce
    first = refund(client, paid_order["id"])
    refunded_at = order_state(engine, paid_order["id"])["refunded_at"]

    second = refund(client, paid_order["id"])

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json() == second.json()
    # Terminal money state: one call, one event, one timestamp.
    assert len(stripe_checkout.refunds) == 1
    assert event_names(engine, paid_order["id"]).count("refund_succeeded") == 1
    assert audit_actions(engine, paid_order["id"]).count("refund_succeeded") == 1
    assert order_state(engine, paid_order["id"])["refunded_at"] == refunded_at


def test_refund_gateway_failure_keeps_the_money_pending_as_a_business_error(
    commerce, variant, paid_order, stripe_checkout, failing_gateway, monkeypatch
):
    client, engine = commerce
    monkeypatch.setattr(payments, "default_gateway", lambda: failing_gateway)

    response = refund(client, paid_order["id"])

    # A refused refund is a business outcome with a stable code, never a 500 that the Next
    # proxy would report to the customer as "backend unavailable".
    assert response.status_code == 409
    assert response.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    assert failing_gateway.calls == ["refund"]
    money = money_state(engine, paid_order["id"])
    assert (money["status"], money["refunded_at"]) == ("refund_pending", None)
    # The order stays a sale while the money is on its way back, and its stock stays sold.
    assert order_state(engine, paid_order["id"])["status"] == "paid"
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, paid_order["id"]) == ["consumed"]
    assert event_names(engine, paid_order["id"]).count("refund_failed") == 1
    assert "refund_failed" in audit_actions(engine, paid_order["id"])
    assert attempts_of(engine, paid_order["id"]) == 1

    # A repeat request finds money that is still owed back: it never opens a second
    # refund, and it never reports success for money that has not moved.
    repeated = refund(client, paid_order["id"])

    assert repeated.status_code == 409
    assert repeated.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    assert failing_gateway.calls == ["refund"]
    assert attempts_of(engine, paid_order["id"]) == 1
    assert money_state(engine, paid_order["id"])["status"] == "refund_pending"


def test_refund_without_a_recorded_payment_intent_stays_a_business_error(
    commerce, paid_order, stripe_checkout
):
    client, engine = commerce
    # A payment captured without an intent cannot be refunded through the gateway port;
    # that must be a recorded failure, not a TypeError surfacing as a 500.
    set_money(engine, paid_order["id"], payment_intent=None)

    response = refund(client, paid_order["id"])

    assert response.status_code == 409
    assert response.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    assert stripe_checkout.refunds == []
    assert money_state(engine, paid_order["id"])["status"] == "refund_pending"
    assert attempts_of(engine, paid_order["id"]) == 1


def test_refund_of_released_money_waits_for_the_compensation_pass(
    commerce, refund_pending_order, stripe_checkout
):
    client, engine = commerce
    # Pay-after-release money is already flagged as owed: the endpoint adds no second
    # Stripe refund and claims no success, and the command is the retry path.
    refused = refund(client, refund_pending_order["id"])

    assert refused.status_code == 409
    assert refused.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    assert stripe_checkout.refunds == []
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"

    with Session(engine) as db, db.begin():
        assert refund_pending_payments(db, gateway=stripe_checkout) == 1

    assert money_state(engine, refund_pending_order["id"])["status"] == "refunded"
    assert order_state(engine, refund_pending_order["id"])["status"] == "refunded"


def test_compensation_pass_rejects_an_unbounded_batch(commerce, refund_pending_order):
    _, engine = commerce
    with Session(engine) as db, db.begin():
        with pytest.raises(ValueError, match="Refund batch size"):
            refund_pending_payments(db, limit=-1)
    # A negative limit would silently mean "no limit" in SQL, so it is refused instead.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"


def test_compensation_pass_refunds_pending_money_and_is_repeatable(
    commerce, refund_pending_order, stripe_checkout
):
    _, engine = commerce
    # The pay-after-release signal: money captured for an order whose stock was released.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"

    with Session(engine) as db, db.begin():
        assert refund_pending_payments(db, gateway=stripe_checkout) == 1

    money = money_state(engine, refund_pending_order["id"])
    assert (money["status"], money["refunded_at"] is not None) == ("refunded", True)
    state = order_state(engine, refund_pending_order["id"])
    assert (state["status"], state["refunded_at"] is not None) == ("refunded", True)
    assert event_names(engine, refund_pending_order["id"]).count("refund_succeeded") == 1
    assert "refund_succeeded" in audit_actions(engine, refund_pending_order["id"])
    assert stripe_checkout.refunds == [
        {
            "payment_intent": "pi_test_late",
            "idempotency_key": f"refund:{refund_pending_order['id']}",
        }
    ]

    # Running the command again finds nothing left to do and never refunds twice.
    with Session(engine) as db, db.begin():
        assert refund_pending_payments(db, gateway=stripe_checkout) == 0
    assert len(stripe_checkout.refunds) == 1


def test_compensation_pass_records_every_failed_attempt(
    commerce, refund_pending_order, failing_gateway
):
    _, engine = commerce

    for expected in (1, 2):
        with pytest.raises(RuntimeError, match="Refund pass failed"):
            run_compensation_pass(engine, failing_gateway)
        # Both the raised failure signal and the attempt record survive the caller's
        # rollback, which is what makes a failed pass diagnosable at all.
        assert attempts_of(engine, refund_pending_order["id"]) == expected

    assert failing_gateway.calls == ["refund", "refund"]
    money = money_state(engine, refund_pending_order["id"])
    assert (money["status"], money["refunded_at"]) == ("refund_pending", None)
    assert order_state(engine, refund_pending_order["id"])["status"] == "cancelled"


def test_compensation_pass_skips_a_disabled_store_without_an_outbound_call(
    commerce, refund_pending_order, failing_gateway, monkeypatch
):
    _, engine = commerce
    monkeypatch.setattr(settings, "stripe_enabled", False)

    with Session(engine) as db, db.begin():
        assert refund_pending_payments(db, gateway=failing_gateway) == 0

    assert failing_gateway.calls == []
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"
