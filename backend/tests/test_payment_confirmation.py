"""Payment confirmation, and the guard that keeps captured money out of the stock.

``orders.status`` (fulfilment) and ``payments.status`` (money) are deliberately separate
axes, so "the customer paid but the stock was already released" is representable without a
fifth order status. The tests below pin the three invariants that separation exists to
hold:

1. ``orders.status='paid'`` means the money was captured -- ``payments.status`` is one of
   ``succeeded``, ``refund_pending`` (a refund is owed but not completed) or ``refunded`` --
   and every reservation of that order is ``consumed``;
2. a released order with captured money becomes ``refund_pending``, the only source of the
   "this customer is owed money" signal;
3. ``payments.status='succeeded'`` never puts stock back on sale.

Invariant 1 used to read "``paid`` implies ``succeeded``", which the refund axis cannot
honour: a refund that Stripe did not complete leaves ``payments.status='refund_pending'``
while the order is still a sale to fulfil. The money axis is reported to clients as
``payment_status`` on every order view, so both halves are readable without collapsing the
two axes into one.

Every confirmation runs under the cart lock and re-reads the order inside it, exactly like
checkout, customer cancellation and the expiry sweep, so the two sides of the
``checkout.session.completed`` vs. release race are serialized instead of interleaved.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from time import sleep
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.application import expiry
from app.application.commerce import release_order
from app.application.payments import ConfirmOutcome, confirm_payment
from app.domain.models import AuditLog, Inventory, Order, Payment, PaymentEvent, Reservation
from tests.conftest import place_order, session_post, update_order

# dc-1001's first variant holds this many sellable units in the seeded catalog.
SEEDED_AVAILABLE = 10


def confirm(engine, order_id, *, provider_reference, payment_intent="pi_test_confirm"):
    """Run one confirmation in its own transaction, the way the webhook handler does."""
    with Session(engine) as db, db.begin():
        return confirm_payment(
            db,
            order_id=order_id,
            provider_reference=provider_reference,
            payment_intent=payment_intent,
        )


def confirm_with_bounded_retries(engine, order_id, *, provider_reference, attempts=3):
    """Confirm, tolerating a lost write-lock race a bounded number of times.

    SQLite serializes short write transactions by waiting, and a lost wait is the same race
    seen through another mechanism; Stripe redelivers, so a bounded retry is honest. The
    bound is the point: an unbounded wait here is what wedged this suite before.
    """
    for attempt in range(attempts):
        try:
            return confirm(engine, order_id, provider_reference=provider_reference)
        except OperationalError:
            if attempt == attempts - 1:
                raise
            sleep(0.05)
    raise AssertionError("unreachable")


def order_state(engine, order_id):
    with Session(engine) as db:
        order = db.get(Order, order_id)
        return dict(
            status=order.status,
            paid_at=order.paid_at,
            expires_at=order.expires_at,
            cancellation_reason=order.cancellation_reason,
        )


def money_state(engine, order_id):
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        if payment is None:
            return None
        return dict(
            status=payment.status,
            provider=payment.provider,
            reference=payment.provider_reference,
            payment_intent=payment.payment_intent,
            amount=payment.amount,
            currency=payment.currency,
        )


def money_rows(engine):
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(Payment))


def reservation_statuses(engine, order_id):
    with Session(engine) as db:
        return list(db.scalars(select(Reservation.status).where(Reservation.order_id == order_id)))


def stock_levels(engine, variant_id):
    with Session(engine) as db:
        stock = db.get(Inventory, variant_id)
        return (stock.available, stock.reserved)


def event_names(engine, order_id):
    """Sorted: payment events carry opaque ids, not a sequence the tests may rely on."""
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        return sorted(
            db.scalars(select(PaymentEvent.event).where(PaymentEvent.payment_id == payment.id))
        )


def audit_actions(engine, entity_id):
    with Session(engine) as db:
        return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id)))


def set_money(engine, order_id, **values):
    with Session(engine) as db, db.begin():
        db.execute(update(Payment).where(Payment.order_id == order_id).values(**values))


def test_confirmation_consumes_reservation_and_keeps_stock_out_of_available(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    # Creating the order moved one unit from available to reserved.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)

    outcome = confirm(engine, payable_order["id"], provider_reference=stripe_checkout.session_id)

    assert outcome == ConfirmOutcome(status="paid", order_id=payable_order["id"])
    # The quantity left `available` when the order was created; confirming only converts
    # the hold into a sale, so `available` must not move and `reserved` must drop.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, payable_order["id"]) == ["consumed"]


def test_confirmation_sets_paid_and_clears_expiry(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])

    confirm(
        engine,
        payable_order["id"],
        provider_reference=stripe_checkout.session_id,
        payment_intent="pi_test_captured",
    )

    state = order_state(engine, payable_order["id"])
    assert (state["status"], state["paid_at"] is not None, state["expires_at"]) == (
        "paid",
        True,
        None,
    )
    money = money_state(engine, payable_order["id"])
    assert (money["status"], money["reference"], money["payment_intent"]) == (
        "succeeded",
        stripe_checkout.session_id,
        "pi_test_captured",
    )
    assert event_names(engine, payable_order["id"]) == [
        "payment_session_created",
        "payment_succeeded",
    ]
    assert "payment_confirmed" in audit_actions(engine, payable_order["id"])
    assert "inventory_consumed" in audit_actions(engine, variant["id"])


def test_confirmation_is_idempotent_on_repeat_delivery(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    first = confirm(engine, payable_order["id"], provider_reference=stripe_checkout.session_id)
    paid_at = order_state(engine, payable_order["id"])["paid_at"]

    second = confirm(engine, payable_order["id"], provider_reference=stripe_checkout.session_id)

    assert (first.status, second.status) == ("paid", "already_paid")
    # A repeat delivery changes nothing: one money row, one consumed hold, one deduction.
    assert money_rows(engine) == 1
    assert reservation_statuses(engine, payable_order["id"]) == ["consumed"]
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert order_state(engine, payable_order["id"])["paid_at"] == paid_at
    assert event_names(engine, payable_order["id"]) == [
        "payment_session_created",
        "payment_succeeded",
    ]


def test_a_confirmed_payment_learns_its_identifier_from_a_later_delivery(
    commerce, paid_order, stripe_checkout
):
    """The identifier of an already-confirmed payment may still be missing, and can be filled.

    The projection is allowed to carry no payment intent, and a confirmation that captured
    money without one could never hand it to the gateway: every later delivery carried the
    identifier and every one was dropped by the idempotent early return, so the debt had no
    way out. Filling a missing identifier is the only write a replay may still make, and the
    money axis never moves -- a ``succeeded`` payment stays ``succeeded``.
    """
    _, engine = commerce
    set_money(engine, paid_order["id"], payment_intent=None)

    outcome = confirm(
        engine,
        paid_order["id"],
        provider_reference=stripe_checkout.session_id,
        payment_intent="pi_test_backfilled",
    )

    assert outcome.status == "already_paid"
    money = money_state(engine, paid_order["id"])
    assert (money["status"], money["payment_intent"]) == ("succeeded", "pi_test_backfilled")
    assert event_names(engine, paid_order["id"]) == [
        "payment_intent_recorded",
        "payment_session_created",
        "payment_succeeded",
    ]
    assert audit_actions(engine, paid_order["id"]).count("payment_intent_recorded") == 1


def test_confirmation_after_release_moves_payment_to_refund_pending(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    # The release side of the race: the reservation is gone and the stock is on sale again.
    assert client.post(f"/api/v1/orders/{payable_order['id']}/cancel").json()["status"] == (
        "cancelled"
    )
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)
    assert reservation_statuses(engine, payable_order["id"]) == ["released"]

    outcome = confirm(
        engine,
        payable_order["id"],
        provider_reference=stripe_checkout.session_id,
        payment_intent="pi_test_late",
    )

    assert outcome == ConfirmOutcome(status="refund_pending", order_id=payable_order["id"])
    money = money_state(engine, payable_order["id"])
    assert (money["status"], money["payment_intent"]) == ("refund_pending", "pi_test_late")
    assert event_names(engine, payable_order["id"]) == [
        "payment_after_release",
        "payment_session_created",
    ]
    assert "payment_after_release" in audit_actions(engine, payable_order["id"])


def test_confirmation_after_release_does_not_rewrite_its_event_on_redelivery(
    commerce, payable_order, stripe_checkout
):
    """Stripe redelivers: the second delivery of already-refund-pending money writes nothing."""
    client, engine = commerce
    session_post(client, payable_order["id"])
    client.post(f"/api/v1/orders/{payable_order['id']}/cancel")
    first = confirm(
        engine,
        payable_order["id"],
        provider_reference=stripe_checkout.session_id,
        payment_intent="pi_test_late",
    )

    second = confirm(
        engine,
        payable_order["id"],
        provider_reference=stripe_checkout.session_id,
        payment_intent="pi_test_late",
    )

    # The owed refund is unchanged, so it is reported once and recorded once.
    assert first.status == second.status == "refund_pending"
    assert event_names(engine, payable_order["id"]) == [
        "payment_after_release",
        "payment_session_created",
    ]
    assert audit_actions(engine, payable_order["id"]).count("payment_after_release") == 1
    assert money_state(engine, payable_order["id"])["status"] == "refund_pending"
    assert order_state(engine, payable_order["id"])["status"] == "cancelled"


def test_confirmation_after_release_never_restores_buyable_order(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    client.post(f"/api/v1/orders/{payable_order['id']}/cancel")

    confirm(
        engine,
        payable_order["id"],
        provider_reference=stripe_checkout.session_id,
        payment_intent="pi_test_late",
    )

    state = order_state(engine, payable_order["id"])
    assert (state["status"], state["paid_at"], state["cancellation_reason"]) == (
        "cancelled",
        None,
        "customer_cancelled",
    )
    assert client.get(f"/api/v1/orders/{payable_order['id']}").json()["status"] == "cancelled"
    # The hold stays released and nothing was taken off the shelf a second time.
    assert reservation_statuses(engine, payable_order["id"]) == ["released"]
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)
    assert money_state(engine, payable_order["id"])["status"] != "succeeded"


def test_confirmation_for_an_unknown_order_is_ignored(commerce):
    _, engine = commerce
    outcome = confirm(engine, str(uuid4()), provider_reference="cs_test_unknown")
    # A session this store never opened writes nothing at all.
    assert outcome.status == "ignored"
    assert money_rows(engine) == 0


def test_confirmation_ignores_a_session_that_belongs_to_another_order(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    stripe_checkout.session_id = "cs_test_second"
    other = place_order(client, variant, key="other-order")
    assert session_post(client, other["id"]).json()["code"] == "payment_ready"

    outcome = confirm(engine, other["id"], provider_reference="cs_test_fake")

    # The session's money belongs to the first order: attributing it here would mislabel
    # someone else's payment and collide with the unique session reference.
    assert outcome.status == "ignored"
    assert order_state(engine, other["id"])["status"] == "pending_payment"
    assert money_state(engine, other["id"])["status"] == "requires_payment"
    assert money_state(engine, payable_order["id"])["status"] == "requires_payment"


def test_confirmation_of_a_refunded_order_is_ignored(
    commerce, variant, paid_order, stripe_checkout
):
    _, engine = commerce
    # Terminal money state: nothing may be resurrected or recorded a second time.
    set_money(engine, paid_order["id"], status="refunded")
    update_order(engine, paid_order["id"], status="refunded", refunded_at=datetime.now(UTC))
    before = (
        order_state(engine, paid_order["id"]),
        money_state(engine, paid_order["id"]),
        stock_levels(engine, variant["id"]),
    )

    outcome = confirm(engine, paid_order["id"], provider_reference=stripe_checkout.session_id)

    assert outcome.status == "ignored"
    assert (
        order_state(engine, paid_order["id"]),
        money_state(engine, paid_order["id"]),
        stock_levels(engine, variant["id"]),
    ) == before


def test_the_order_view_reports_the_captured_money_axis(commerce, paid_order):
    """A paid order says both things at once: a sale to fulfil and captured money (F11)."""
    client, _ = commerce

    body = client.get(f"/api/v1/orders/{paid_order['id']}").json()

    assert (body["status"], body["payment_status"]) == ("paid", "succeeded")


def test_an_order_with_no_payment_row_reports_no_money_axis(commerce, variant):
    """The convention for an order the payment channel never touched.

    No payment row exists, so there is no money state to report: ``None``. It is not the
    same statement as ``disabled``, which is the row a switched-off provider writes when it
    is asked for a session, and a client must be able to tell the two apart.
    """
    client, _ = commerce
    order = place_order(client, variant)

    body = client.get(f"/api/v1/orders/{order['id']}").json()

    assert (body["status"], body["payment_status"]) == ("pending_payment", None)


def test_release_order_refuses_a_paid_order(commerce, variant, paid_order):
    _, engine = commerce
    with Session(engine) as db, pytest.raises(RuntimeError, match="settled payment"), db.begin():
        release_order(db, db.get(Order, paid_order["id"]), "expired")

    # Raising is only half the guarantee: the sold stock must be untouched as well.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, paid_order["id"]) == ["consumed"]
    assert order_state(engine, paid_order["id"])["status"] == "paid"
    assert money_state(engine, paid_order["id"])["status"] == "succeeded"
    assert "inventory_released" not in audit_actions(engine, variant["id"])


def test_release_order_refuses_a_refund_pending_order(commerce, variant, refund_pending_order):
    _, engine = commerce
    with Session(engine) as db, pytest.raises(RuntimeError, match="settled payment"), db.begin():
        release_order(db, db.get(Order, refund_pending_order["id"]), "customer_cancelled")

    # The refund is still owed, and the already-released stock was not touched again.
    assert money_state(engine, refund_pending_order["id"])["status"] == "refund_pending"
    assert reservation_statuses(engine, refund_pending_order["id"]) == ["released"]
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)


def test_release_guard_logs_the_refusal_without_payment_details(commerce, paid_order, caplog):
    _, engine = commerce
    caplog.set_level(logging.ERROR, logger="commerce.orders")
    with Session(engine) as db, pytest.raises(RuntimeError), db.begin():
        release_order(db, db.get(Order, paid_order["id"]), "expired")

    events = [
        json.loads(record.message) for record in caplog.records if record.name == "commerce.orders"
    ]
    assert {
        "event": "inventory_release_refused",
        "order_id": paid_order["id"],
        "reason": "expired",
    } in events
    # Neither the Stripe session nor the key may reach a log line.
    assert "cs_test" not in caplog.text
    assert "sk_test" not in caplog.text


def test_expired_sweep_cannot_release_a_paid_order(commerce, variant, paid_order):
    _, engine = commerce
    # A stale deadline on a confirmed order: the sweep must not put its stock back on sale.
    update_order(engine, paid_order["id"], expires_at=datetime.now(UTC) - timedelta(seconds=1))

    assert expiry.expire_due_orders(sessionmaker(engine), now=datetime.now(UTC)) == 0

    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, paid_order["id"]) == ["consumed"]
    assert "inventory_released" not in audit_actions(engine, variant["id"])


def test_sweep_that_selected_an_order_first_never_releases_it_after_confirmation(
    commerce, variant, payable_order, stripe_checkout
):
    """The sweep re-reads under the cart lock, so a confirmation that wins stops it."""
    client, engine = commerce
    session_post(client, payable_order["id"])
    cutoff = datetime.now(UTC)
    update_order(engine, payable_order["id"], expires_at=cutoff - timedelta(seconds=1))
    confirmed = []

    class ConfirmAfterCandidateRead(Session):
        """Interleave: the sweep has already picked the order when the payment lands."""

        def close(self):
            super().close()
            if not confirmed:
                confirmed.append(1)
                outcome = confirm(
                    engine,
                    payable_order["id"],
                    provider_reference=stripe_checkout.session_id,
                )
                assert outcome.status == "paid"

    sessions = sessionmaker(engine, class_=ConfirmAfterCandidateRead)
    assert expiry.expire_due_orders(sessions, now=cutoff) == 0

    # The sweep found the order already paid under the lock and released nothing.
    assert confirmed == [1]
    assert order_state(engine, payable_order["id"])["status"] == "paid"
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert reservation_statuses(engine, payable_order["id"]) == ["consumed"]
    assert money_state(engine, payable_order["id"])["status"] == "succeeded"


def test_release_guard_refuses_an_order_sitting_in_pending_while_its_money_settled(
    commerce, variant, payable_order, stripe_checkout
):
    """The exact state the guard exists for: fulfilment open, money already captured.

    ``order.status`` is deliberately left ``pending_payment`` with its reservation still
    ``active``, so the stock *would* have gone back on sale without the guard. Refusing is
    only half of it: the sold stock must not have moved either.
    """
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    set_money(engine, payable_order["id"], status="succeeded")

    with Session(engine) as db, pytest.raises(RuntimeError, match="settled payment"), db.begin():
        release_order(db, db.get(Order, payable_order["id"]), "expired")

    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert order_state(engine, payable_order["id"])["status"] == "pending_payment"
    assert money_state(engine, payable_order["id"])["status"] == "succeeded"
    assert "inventory_released" not in audit_actions(engine, variant["id"])


def test_expired_sweep_cannot_release_an_order_whose_money_settled(
    commerce, variant, payable_order, stripe_checkout
):
    """The sweep path: an over-due order that is still spendable for the guard to refuse."""
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    set_money(engine, payable_order["id"], status="succeeded")
    update_order(engine, payable_order["id"], expires_at=datetime.now(UTC) - timedelta(seconds=1))

    # The refusal is reported as an order the sweep could not clean up, never as a release.
    with pytest.raises(RuntimeError, match="Reservation sweep failed"):
        expiry.expire_due_orders(sessionmaker(engine), now=datetime.now(UTC))

    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert order_state(engine, payable_order["id"])["status"] == "pending_payment"
    assert "inventory_released" not in audit_actions(engine, variant["id"])


def test_customer_cancel_cannot_release_an_order_whose_money_settled(
    commerce, variant, payable_order, stripe_checkout
):
    """The customer path: cancelling must fail rather than release captured stock."""
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    set_money(engine, payable_order["id"], status="refund_pending")

    response = client.post(f"/api/v1/orders/{payable_order['id']}/cancel")

    # A refusal is an infrastructure error the caller may retry, not a business outcome.
    assert response.status_code == 500
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert order_state(engine, payable_order["id"])["status"] == "pending_payment"
    assert money_state(engine, payable_order["id"])["status"] == "refund_pending"
    assert "inventory_released" not in audit_actions(engine, variant["id"])


@pytest.mark.parametrize("first_move", ["confirmation", "release"])
def test_concurrent_confirmation_and_release_only_ever_agree(
    commerce, variant, payable_order, stripe_checkout, first_move
):
    """Both sides of ``checkout.session.completed`` vs. release, running at the same time.

    Whichever side takes the cart lock first decides the outcome, and only the two
    consistent outcomes may survive: fulfilled (paid, reservations consumed, stock stays
    deducted, nothing released) or refunded (cancelled, ``refund_pending``, stock on sale
    again, exactly one release). A ``cancelled`` order with a ``succeeded`` payment, or
    ``paid`` with released stock, would break invariants 1-3.

    Neither side ever waits on the other and every wait below is bounded: the deadlines
    exist to fail loudly instead of wedging the suite, which is how this test used to hang.
    ``first_move`` only decides which side is started on the first beat, so a run can
    observe either allowed outcome; both arrangements assert the same cross-product.
    """
    client, engine = commerce
    session_post(client, payable_order["id"])
    cutoff = datetime.now(UTC)
    update_order(engine, payable_order["id"], expires_at=cutoff - timedelta(seconds=1))
    sides = {
        "confirmation": lambda: confirm_with_bounded_retries(
            engine, payable_order["id"], provider_reference=stripe_checkout.session_id
        ),
        "release": lambda: expiry.expire_due_orders(sessionmaker(engine), now=cutoff),
    }
    other = "release" if first_move == "confirmation" else "confirmation"
    started = Event()

    def announce(name):
        started.set()
        return sides[name]()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(announce, first_move)
        assert started.wait(timeout=10), f"{first_move} never started"
        second = pool.submit(sides[other])
        futures = {first_move: first, other: second}
        try:
            released = futures["release"].result(timeout=30)
        except RuntimeError:
            # A bounded lock wait that ran out releases nothing and reports the order as
            # failed. Only the confirmation holding the lock can cause that here.
            released = 0
        outcome = futures["confirmation"].result(timeout=30)

    fulfilled = (
        "paid",
        "succeeded",
        ["consumed"],
        (SEEDED_AVAILABLE - 1, 0),
        0,
        "paid",
    )
    refunded = (
        "cancelled",
        "refund_pending",
        ["released"],
        (SEEDED_AVAILABLE, 0),
        1,
        "refund_pending",
    )
    observed = (
        order_state(engine, payable_order["id"])["status"],
        money_state(engine, payable_order["id"])["status"],
        reservation_statuses(engine, payable_order["id"]),
        stock_levels(engine, variant["id"]),
        released,
        outcome.status,
    )
    # Exactly these two, and nothing that mixes one side's outcome with the other's stock.
    assert observed in (fulfilled, refunded)
