"""Refunds: captured money leaves through one idempotent path, or stays owed.

The refund is the counterpart of the release guard, and it is the only path that moves a
``succeeded`` payment to ``refunded`` -- and only when Stripe itself reports the Refund as
``succeeded``. One attempt either moves both axes together (``payments.status='refunded'``
and ``orders.status='refunded'``) or leaves the money at ``refund_pending`` with the attempt
recorded; stock never goes back on sale either way.
Every attempt reaches Stripe through the same deterministic idempotency key, so re-running
the request or the compensation command cannot refund twice.

The debt itself is written before the gateway is asked for the money: a request that cannot
record its settlement leaves ``refund_pending`` behind rather than ``succeeded``, which is
the one money state the compensation command cannot see, and a request whose whole
transaction is discarded is recovered by the retry that reaches Stripe under the same key.
That command takes the same cart write lock every other writer takes before re-reading a
candidate, so two passes over one debt serialize instead of both paying it out, and it
serves candidates by recorded attempt count rather than by id, so a debt that can never
settle cannot occupy the batch forever.

Every outbound call goes to the fake gateways defined in ``conftest.py``: no test in this
file performs network access.
"""

import contextlib
import io
import runpy
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.application import payments
from app.application.payments import refund_attempts, refund_pending_payments
from app.config import settings
from app.dependencies import database
from app.domain.models import AuditLog, Inventory, Order, Payment, PaymentEvent, Reservation
from app.main import app
from tests.conftest import FailingStripeGateway, FakeStripeGateway, place_order, session_post

# dc-1001's first variant holds this many sellable units in the seeded catalog.
SEEDED_AVAILABLE = 10
NOT_REFUNDABLE = "This payment cannot be refunded"
REFUND_FAILED = "The refund could not be completed"
REFUNDS_UNAVAILABLE = "Refunds are not available right now. Please try again later."

# A payment id no generated uuid4 can beat, so a test can pin which candidate a batch of
# ``limit`` one serves first. The payment state behind it is the one a confirmation writes
# for money captured without a payment intent.
STUCK_PAYMENT_ID = "00000000-0000-4000-8000-000000000000"


class BlockingRefundGateway(FakeStripeGateway):
    """A refund that waits for the test, so a second pass can be started while it runs."""

    def __init__(self, entered: Event, proceed: Event) -> None:
        super().__init__()
        self._entered = entered
        self._proceed = proceed

    def refund(self, *, payment_intent: str, idempotency_key: str):
        self._entered.set()
        # Bounded: a wedged wait must fail the test, not hang the suite.
        assert self._proceed.wait(timeout=10), "the blocked refund was never released"
        return super().refund(payment_intent=payment_intent, idempotency_key=idempotency_key)


class SignallingFailingGateway(FailingStripeGateway):
    """A gateway that records and announces any attempt: the loser must never reach it."""

    def __init__(self, attempted: Event) -> None:
        super().__init__()
        self._attempted = attempted

    def refund(self, *, payment_intent: str, idempotency_key: str):
        self._attempted.set()
        return super().refund(payment_intent=payment_intent, idempotency_key=idempotency_key)


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


def audit_details(engine, entity_id, action):
    with Session(engine) as db:
        return list(
            db.scalars(
                select(AuditLog.details).where(
                    AuditLog.entity_id == entity_id, AuditLog.action == action
                )
            )
        )


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


def sessions_of(engine):
    """A sessionmaker shaped like the application's own: one session per pass attempt."""
    return sessionmaker(engine, class_=Session, expire_on_commit=False)


def run_compensation_pass(engine, gateway):
    """Run the pass the way the CLI does: its own sessions, its own error."""
    return refund_pending_payments(sessions_of(engine), gateway=gateway)


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

    # A disabled store must not construct a gateway that would call Stripe with no key. The
    # refusal is about the channel, not about this money: the payment never becomes
    # unrefundable, so it must not borrow ``payment_not_refundable``.
    assert response.status_code == 409
    assert response.json() == {"code": "refunds_unavailable", "detail": REFUNDS_UNAVAILABLE}
    assert stripe_checkout.refunds == []
    assert money_state(engine, paid_order["id"])["status"] == "succeeded"
    assert event_names(engine, paid_order["id"]).count("refund_failed") == 0


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
        # The intent is on the rows before Stripe is asked, so the debt this store holds
        # survives whatever happens to the request after the money moved.
        "refund_requested",
        "refund_succeeded",
    ]
    assert "refund_succeeded" in audit_actions(engine, paid_order["id"])
    # A refund is a money event, never a stock event: nothing goes back on sale here.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, paid_order["id"]) == ["consumed"]


def test_a_failed_refund_is_readable_as_paid_money_on_its_way_back(
    commerce, paid_order, stripe_checkout, failing_gateway, monkeypatch
):
    """The refund axis, read back through the order view (P0-④/F11).

    The money is owed but not back yet, and the order is deliberately still a sale to
    fulfil, so the two axes disagree by design. A client can only act on that if it can read
    both halves of the order.
    """
    client, engine = commerce
    monkeypatch.setattr(payments, "default_gateway", lambda: failing_gateway)
    assert refund(client, paid_order["id"]).status_code == 409

    body = client.get(f"/api/v1/orders/{paid_order['id']}").json()

    assert (body["status"], body["payment_status"]) == ("paid", "refund_pending")
    assert money_state(engine, paid_order["id"])["status"] == "refund_pending"


def test_a_completed_refund_reports_the_refunded_money_axis(commerce, paid_order, stripe_checkout):
    client, _ = commerce

    response = refund(client, paid_order["id"])

    assert response.status_code == 200
    assert (response.json()["status"], response.json()["payment_status"]) == (
        "refunded",
        "refunded",
    )
    assert client.get(f"/api/v1/orders/{paid_order['id']}").json()["payment_status"] == ("refunded")


def test_the_client_can_tell_a_released_hold_from_money_owed_back(
    commerce, variant, refund_pending_order, stripe_checkout
):
    """Both orders are ``cancelled``; only the money axis separates them (F11)."""
    client, engine = commerce
    plain = place_order(client, variant, key="no-money-behind-it")
    assert client.post(f"/api/v1/orders/{plain['id']}/cancel").json()["status"] == "cancelled"

    released = client.get(f"/api/v1/orders/{plain['id']}").json()
    owed = client.get(f"/api/v1/orders/{refund_pending_order['id']}").json()

    assert (released["status"], released["payment_status"]) == ("cancelled", None)
    assert (owed["status"], owed["payment_status"]) == ("cancelled", "refund_pending")
    assert money_state(engine, plain["id"]) is None


def test_refund_records_the_gateway_reference_for_reconciliation(
    commerce, paid_order, stripe_checkout
):
    client, engine = commerce
    assert refund(client, paid_order["id"]).status_code == 200

    # The gateway's own refund id is what a reconciliation reads back to match the money
    # movement. It is an identifier, not a key or a session reference.
    details = audit_details(engine, paid_order["id"], "refund_succeeded")
    assert [detail["refund_id"] for detail in details] == ["re_test_fake"]


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


def test_the_debt_is_on_the_rows_before_the_gateway_is_asked(
    commerce, paid_order, stripe_checkout, monkeypatch
):
    """Stripe's answer is the point of no return, so the intent has to precede the call.

    The window this closes is the one after the money left: a settlement write that never
    lands must leave ``refund_pending`` -- the only state the compensation pass selects --
    and the failed attempt behind, instead of a ``succeeded`` payment nothing looks at
    again. Reading through the request's own transaction from inside the gateway call is
    what proves the order of the two writes: the money axis already says
    ``refund_pending`` and the attempt is already recorded when Stripe is asked.
    """
    client, engine = commerce
    live: dict = {}
    seen: list[tuple[str, list[str]]] = []

    def capturing_transaction():
        with Session(engine) as db, db.begin():
            live["db"] = db
            yield db

    class SeeingRefundGateway(FakeStripeGateway):
        def refund(self, *, payment_intent: str, idempotency_key: str):
            db = live["db"]
            payment = db.scalar(select(Payment).where(Payment.payment_intent == payment_intent))
            seen.append(
                (
                    payment.status,
                    sorted(
                        db.scalars(
                            select(PaymentEvent.event).where(PaymentEvent.payment_id == payment.id)
                        )
                    ),
                )
            )
            return super().refund(payment_intent=payment_intent, idempotency_key=idempotency_key)

    owner = app.dependency_overrides[database]
    app.dependency_overrides[database] = capturing_transaction
    monkeypatch.setattr(payments, "default_gateway", SeeingRefundGateway)
    try:
        assert refund(client, paid_order["id"]).status_code == 200
    finally:
        app.dependency_overrides[database] = owner

    assert seen == [
        (
            "refund_pending",
            ["payment_session_created", "payment_succeeded", "refund_requested"],
        )
    ]


def test_a_settlement_that_cannot_be_recorded_stays_a_debt_the_command_finishes(
    commerce, paid_order, stripe_checkout, monkeypatch
):
    """Money Stripe has already given back must never read ``succeeded`` locally.

    The intent is written before the gateway is asked, so a settlement write that fails
    leaves ``refund_pending`` behind: the pass selects that row, re-asks with the same
    idempotency key (Stripe answers with the refund it already made) and records the
    settlement. Before this fix the request answered 500 and the money stayed ``succeeded``
    -- the one state neither the pass nor an operator could find.
    """
    client, engine = commerce
    real_record_success = payments._record_refund_success

    def unrecordable(db, order, payment, refund_reference):
        raise SQLAlchemyError("simulated settlement write failure")

    monkeypatch.setattr(payments, "_record_refund_success", unrecordable)

    response = refund(client, paid_order["id"])

    # The refusal is about the record this store holds, and it is returned as data so the
    # transaction that owns the debt commits instead of unwinding it.
    assert response.status_code == 409
    assert response.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    assert stripe_checkout.refunds == [
        {"payment_intent": "pi_test_paid", "idempotency_key": f"refund:{paid_order['id']}"}
    ]
    money = money_state(engine, paid_order["id"])
    assert (money["status"], money["refunded_at"]) == ("refund_pending", None)
    assert attempts_of(engine, paid_order["id"]) == 1

    monkeypatch.setattr(payments, "_record_refund_success", real_record_success)

    assert run_compensation_pass(engine, stripe_checkout) == 1

    assert money_state(engine, paid_order["id"])["status"] == "refunded"
    assert order_state(engine, paid_order["id"])["status"] == "refunded"
    # One order, one key: the retry cannot move money Stripe has already returned.
    assert [call["idempotency_key"] for call in stripe_checkout.refunds] == [
        f"refund:{paid_order['id']}",
        f"refund:{paid_order['id']}",
    ]


def test_a_request_that_is_thrown_away_is_recovered_by_the_same_key(
    commerce, paid_order, stripe_checkout
):
    """The window the transaction boundary cannot close, and how it is still repaid.

    A caller that discards the whole transaction -- the shape of a crash between Stripe's
    answer and this request's commit -- takes the intent down with it, so nothing is left
    for the pass to discover; the cell below states that honestly. What makes it
    recoverable is the key: the retry asks Stripe for the same refund and the settlement is
    recorded from Stripe's own answer, never from a second money movement.
    """
    client, engine = commerce

    def abandoned_transaction():
        with Session(engine) as db:
            db.begin()
            try:
                yield db
            finally:
                db.rollback()

    owner = app.dependency_overrides[database]
    app.dependency_overrides[database] = abandoned_transaction
    try:
        assert refund(client, paid_order["id"]).status_code == 200
        # Stripe refunded and this store kept nothing: no pass can select this row.
        assert money_state(engine, paid_order["id"])["status"] == "succeeded"
    finally:
        app.dependency_overrides[database] = owner

    assert refund(client, paid_order["id"]).status_code == 200

    assert money_state(engine, paid_order["id"])["status"] == "refunded"
    assert [call["idempotency_key"] for call in stripe_checkout.refunds] == [
        f"refund:{paid_order['id']}",
        f"refund:{paid_order['id']}",
    ]


def test_money_confirmed_without_an_intent_recovers_when_a_later_event_brings_it(
    commerce, refund_pending_order, stripe_checkout
):
    """The projection may legally carry no payment intent, and there has to be a way back.

    A confirmation without an intent cannot hand the money to the gateway, so the attempt
    fails. Leaving it there would make ``missing_payment_intent`` a permanent state: every
    later delivery carried the identifier and every one of them was discarded by the
    idempotent early return. The confirmation now fills an identifier it is missing, which
    is the only write a replayed delivery may still make -- the money axis never moves.
    """
    _, engine = commerce
    set_money(engine, refund_pending_order["id"], payment_intent=None)

    with pytest.raises(RuntimeError, match="Refund pass failed"):
        run_compensation_pass(engine, stripe_checkout)

    assert attempts_of(engine, refund_pending_order["id"]) == 1
    assert stripe_checkout.refunds == []

    with Session(engine) as db, db.begin():
        outcome = payments.confirm_payment(
            db,
            order_id=refund_pending_order["id"],
            provider_reference=stripe_checkout.session_id,
            payment_intent="pi_test_late_recovered",
        )

    money = money_state(engine, refund_pending_order["id"])
    assert outcome.status == "refund_pending"
    assert (money["status"], money["payment_intent"]) == (
        "refund_pending",
        "pi_test_late_recovered",
    )
    assert event_names(engine, refund_pending_order["id"]).count("payment_intent_recorded") == 1

    # With the identifier recorded, the pass can finally give the money back.
    assert run_compensation_pass(engine, stripe_checkout) == 1

    assert money_state(engine, refund_pending_order["id"])["status"] == "refunded"
    assert stripe_checkout.refunds == [
        {
            "payment_intent": "pi_test_late_recovered",
            "idempotency_key": f"refund:{refund_pending_order['id']}",
        }
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


@pytest.mark.parametrize("refund_status", ["pending", "failed"])
def test_a_refund_stripe_has_not_completed_leaves_the_money_owed(
    commerce, variant, paid_order, stripe_checkout, refund_status
):
    """A Refund object is a request, not a settlement: only ``succeeded`` moves the money.

    ``pending``, ``requires_action``, ``failed`` and ``canceled`` all mean the money is
    still the customer's, so writing ``refunded`` here would both claim a refund nobody
    received and drop the debt off the compensation candidates.
    """
    client, engine = commerce
    stripe_checkout.refund_status = refund_status

    response = refund(client, paid_order["id"])

    assert response.status_code == 409
    assert response.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    money = money_state(engine, paid_order["id"])
    assert (money["status"], money["refunded_at"]) == ("refund_pending", None)
    # The order is untouched: it stays a sale to fulfil while the money is owed back.
    state = order_state(engine, paid_order["id"])
    assert (state["status"], state["refunded_at"]) == ("paid", None)
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, paid_order["id"]) == ["consumed"]
    assert event_names(engine, paid_order["id"]).count("refund_succeeded") == 0
    # The reference and the status Stripe reported are recorded, so a reconciliation can
    # read the later status back instead of opening a second refund.
    details = audit_details(engine, paid_order["id"], "refund_failed")
    assert [(d["reason"], d["refund_id"], d["refund_status"]) for d in details] == [
        ("refund_not_settled", "re_test_fake", refund_status)
    ]
    assert attempts_of(engine, paid_order["id"]) == 1

    # Still a compensation candidate: when Stripe settles that same refund, the pass picks
    # the row up and is the only thing that finally writes ``refunded``.
    stripe_checkout.refund_status = "succeeded"
    assert run_compensation_pass(engine, stripe_checkout) == 1

    assert money_state(engine, paid_order["id"])["status"] == "refunded"
    assert order_state(engine, paid_order["id"])["status"] == "refunded"
    assert [call["idempotency_key"] for call in stripe_checkout.refunds] == [
        f"refund:{paid_order['id']}",
        f"refund:{paid_order['id']}",
    ]


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


def test_a_failed_refund_attempt_is_discarded_with_the_transaction_that_owns_it(
    commerce, paid_order, stripe_checkout, failing_gateway, monkeypatch
):
    """Only the owner of a transaction may decide the fate of the writes inside it.

    This request runs inside a caller-owned transaction that ends in a rollback, so the
    ``refund_failed`` record the refund path wrote must vanish with it. Before this fix
    ``refund_order`` committed the attempt itself, so the record outlived the rollback and
    this test failed.
    """
    client, engine = commerce
    monkeypatch.setattr(payments, "default_gateway", lambda: failing_gateway)

    def abandoned_transaction():
        with Session(engine) as db:
            db.begin()
            try:
                yield db
            finally:
                # The caller throws the whole transaction away; nothing a request wrote
                # through the application layer may survive it.
                db.rollback()

    app.dependency_overrides[database] = abandoned_transaction
    response = refund(client, paid_order["id"])

    # The route still answers, and it answers the request that was thrown away.
    assert response.status_code == 409
    # The attempt really reached the gateway; only its record is supposed to be gone.
    assert failing_gateway.calls == ["refund"]
    # Read through a fresh session: only what was committed is visible here.
    money = money_state(engine, paid_order["id"])
    assert (money["status"], money["refunded_at"]) == ("succeeded", None)
    assert event_names(engine, paid_order["id"]).count("refund_failed") == 0
    assert "refund_failed" not in audit_actions(engine, paid_order["id"])
    assert attempts_of(engine, paid_order["id"]) == 0
    assert order_state(engine, paid_order["id"])["status"] == "paid"


def test_a_failed_refund_attempt_is_committed_by_the_transaction_the_route_owns(
    commerce, paid_order, stripe_checkout, failing_gateway, monkeypatch
):
    """The pair of the rollback test: the 409 must still leave the debt recorded.

    The route reports the refusal as a response instead of raising it, so the attempt is
    committed by the transaction the request dependency owns. The assertions read through a
    fresh session, so only committed rows can satisfy them.
    """
    client, engine = commerce
    monkeypatch.setattr(payments, "default_gateway", lambda: failing_gateway)

    response = refund(client, paid_order["id"])

    assert response.status_code == 409
    assert response.json() == {"code": "refund_failed", "detail": REFUND_FAILED}
    assert money_state(engine, paid_order["id"])["status"] == "refund_pending"
    assert event_names(engine, paid_order["id"]).count("refund_failed") == 1
    assert "refund_failed" in audit_actions(engine, paid_order["id"])
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

    assert run_compensation_pass(engine, stripe_checkout) == 1

    assert money_state(engine, refund_pending_order["id"])["status"] == "refunded"
    assert order_state(engine, refund_pending_order["id"])["status"] == "refunded"


def test_compensation_pass_rejects_an_unbounded_batch(commerce, refund_pending_order):
    _, engine = commerce
    with pytest.raises(ValueError, match="Refund batch size"):
        refund_pending_payments(sessions_of(engine), limit=-1)
    # A negative limit would silently mean "no limit" in SQL, so it is refused instead.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"


def test_compensation_pass_refunds_pending_money_and_is_repeatable(
    commerce, refund_pending_order, stripe_checkout
):
    _, engine = commerce
    # The pay-after-release signal: money captured for an order whose stock was released.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"

    assert run_compensation_pass(engine, stripe_checkout) == 1

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
    assert run_compensation_pass(engine, stripe_checkout) == 0
    assert len(stripe_checkout.refunds) == 1


def test_two_compensation_passes_never_both_refund_one_payment(
    commerce, refund_pending_order, stripe_checkout
):
    """Two passes over one debt: the loser waits on the cart lock and finds it settled.

    A pass re-reads each candidate in its own transaction, but without the write lock both
    passes can read the same ``refund_pending`` row, ask Stripe for it and write a second
    terminal state -- the same refund twice by key, but two ``refund_succeeded`` rows and
    two audits locally. Taking the lock every other writer takes (``commerce.lock_cart``)
    before the re-read serializes them: the loser re-reads what the winner committed, drops
    the candidate and never reaches the gateway.
    """
    _, engine = commerce
    entered = Event()
    proceed = Event()
    attempted = Event()
    winner = BlockingRefundGateway(entered, proceed)
    loser = SignallingFailingGateway(attempted)
    outcomes: dict[str, int] = {}

    def run(name, gateway) -> None:
        outcomes[name] = run_compensation_pass(engine, gateway)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(run, "first", winner)
            assert entered.wait(timeout=10), "the first pass never reached Stripe"
            second = pool.submit(run, "second", loser)
            # The loser may not reach the gateway at all: it is waiting for the row lock.
            attempted.wait(timeout=1.0)
            proceed.set()
            first.result(timeout=30)
            second.result(timeout=30)
    finally:
        proceed.set()

    assert loser.calls == []
    assert attempted.is_set() is False
    assert outcomes == {"first": 1, "second": 0}
    assert len(winner.refunds) == 1
    assert money_state(engine, refund_pending_order["id"])["status"] == "refunded"
    # One terminal write, one event, one audit: the loser wrote nothing at all.
    assert event_names(engine, refund_pending_order["id"]).count("refund_succeeded") == 1
    assert audit_actions(engine, refund_pending_order["id"]).count("refund_succeeded") == 1


def test_compensation_pass_records_every_failed_attempt(
    commerce, refund_pending_order, failing_gateway
):
    _, engine = commerce

    for expected in (1, 2):
        with pytest.raises(RuntimeError, match="Refund pass failed"):
            run_compensation_pass(engine, failing_gateway)
        # The pass commits each attempt itself, so a failed attempt is already durable when
        # the pass reports its failure: that is what makes a failed pass diagnosable.
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

    assert refund_pending_payments(sessions_of(engine), gateway=failing_gateway) == 0

    assert failing_gateway.calls == []
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"


def test_refund_command_is_the_compensation_entry_point(
    commerce, refund_pending_order, stripe_checkout, monkeypatch
):
    """``python -m app.refund_pending`` was uncovered until now.

    The replacement takes no arguments on purpose: a command that wrapped the pass in a
    session or transaction of its own would fail this call instead of quietly committing
    work inside someone else's transaction.
    """
    _, engine = commerce
    original = payments.refund_pending_payments
    monkeypatch.setattr(
        payments,
        "refund_pending_payments",
        lambda: original(sessions_of(engine), gateway=stripe_checkout),
    )
    stdout = io.StringIO()

    with contextlib.redirect_stdout(stdout):
        runpy.run_module("app.refund_pending", run_name="__main__")

    assert stdout.getvalue() == "Refunded 1 payments.\n"
    # The command commits the attempt without an outer transaction of its own.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refunded"
    assert order_state(engine, refund_pending_order["id"])["status"] == "refunded"
    assert stripe_checkout.refunds == [
        {
            "payment_intent": "pi_test_late",
            "idempotency_key": f"refund:{refund_pending_order['id']}",
        }
    ]


def test_a_refund_that_can_never_settle_cannot_starve_the_ones_behind_it(
    commerce, variant, refund_pending_order, stripe_checkout
):
    """A batch of ``limit`` one must still serve the candidates a stuck debt is holding up.

    Candidates used to be taken in ``payments.id`` order, so money that can never be
    refunded -- here: captured without a payment intent, which the gateway cannot act on --
    sat at the front of every batch and filled its only slot forever, and the refundable
    debt behind it was never attempted. The queue is now ordered by the recorded attempt
    count, so a row that keeps failing sinks behind every row that has been tried fewer
    times. The debt stays visible and is still retried whenever nothing fresher is waiting.
    """
    client, engine = commerce
    stuck = place_order(client, variant, key="stuck-money")
    assert client.post(f"/api/v1/orders/{stuck['id']}/cancel").json()["status"] == "cancelled"
    with Session(engine) as db, db.begin():
        # Money captured with no identifier to refund: the row a confirmation writes for a
        # late payment whose event carried no intent, pinned to the front of the queue.
        db.add(
            Payment(
                id=STUCK_PAYMENT_ID,
                order_id=stuck["id"],
                provider="stripe",
                status="refund_pending",
                provider_reference="cs_test_stuck",
                amount=Decimal("129.00"),
                currency="USD",
            )
        )

    for _ in range(3):
        with contextlib.suppress(RuntimeError):
            refund_pending_payments(sessions_of(engine), limit=1, gateway=stripe_checkout)

    # The refundable debt was served within a bounded number of passes, and the one that
    # cannot settle is still owed and still recorded rather than silently dropped.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refunded"
    assert money_state(engine, stuck["id"])["status"] == "refund_pending"
    assert attempts_of(engine, stuck["id"]) >= 1


def test_refund_command_reports_nothing_to_do_for_a_disabled_store(
    commerce, refund_pending_order, stripe_checkout, monkeypatch
):
    """A switched-off channel must not even build a gateway: the owed rows stay put."""
    _, engine = commerce
    monkeypatch.setattr(settings, "stripe_enabled", False)
    original = payments.refund_pending_payments
    monkeypatch.setattr(payments, "refund_pending_payments", lambda: original(sessions_of(engine)))
    stdout = io.StringIO()

    with contextlib.redirect_stdout(stdout):
        runpy.run_module("app.refund_pending", run_name="__main__")

    assert stdout.getvalue() == "Refunded 0 payments.\n"
    assert stripe_checkout.refunds == []
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"
