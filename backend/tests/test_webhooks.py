"""Webhook ingestion: one acknowledged delivery per event id, and what a failure means.

The Next public route verifies Stripe's signature and forwards a *projection* of the event;
these tests pin what Python does with it:

1. ``checkout.session.completed`` confirms the payment and consumes the reservation exactly
   once, however many times Stripe delivers the same event id -- but only for the session
   whose ``payment_status`` is ``paid``: an unsettled completion is acknowledged, recorded
   and logged without touching the order, the hold or the stock;
2. an event naming no local order or session is acknowledged as ``ignored``, never answered
   with a 5xx, because Stripe retries anything that is not a 2xx;
3. ``checkout.session.expired`` records the event and releases nothing, so a hold still
   leaves inventory on exactly two paths: the expiry sweep and customer cancellation;
4. a processing failure rolls its partial business writes back, keeps ``failed`` plus the
   attempt count, and answers non-2xx so the delivery is retried;
5. only the projected fields are stored, so no personal data reaches the row or a log;
6. the endpoint fails closed: without a configured ``COMMERCE_PROXY_SECRET`` it refuses
   instead of inheriting the development passthrough that the rest of ``/api/v1`` keeps.
"""

import json
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.application import webhooks
from app.config import settings
from app.domain.models import (
    AuditLog,
    Inventory,
    Order,
    Payment,
    PaymentEvent,
    Reservation,
    WebhookEvent,
)
from tests.conftest import PROXY_SECRET, session_post

# dc-1001's first variant holds this many sellable units in the seeded catalog.
SEEDED_AVAILABLE = 10
COMPLETED_EVENT = "checkout.session.completed"
EXPIRED_EVENT = "checkout.session.expired"

PROJECTION_FIELDS = {
    "id",
    "type",
    "order_id",
    "checkout_session_id",
    "payment_intent",
    "amount_total",
    "currency",
    "payment_status",
}


def webhook(client, payload):
    """Deliver one projected event with the credential the endpoint requires."""
    return client.post(
        "/api/v1/webhooks/stripe", json=payload, headers={"X-Internal-Proxy-Secret": PROXY_SECRET}
    )


@pytest.fixture(autouse=True)
def configured_proxy_credential(proxy_credential):
    """The webhook refuses to run without a configured credential (pinned below), so every
    test in this file walks the gate its own rejection tests assert."""
    return proxy_credential


def order_total_minor(client, order_id):
    """The amount Stripe would have charged, read back from the order the store computed."""
    return int(Decimal(client.get(f"/api/v1/orders/{order_id}").json()["total"]) * 100)


def completed_payload(client, order_id, session_id, event_id, **extra):
    """One completed session whose money did arrive; ``payment_status`` is overridable.

    ``paid`` is the default because it is the only value Stripe sends once the money is
    captured, and every other value is a test that deliberately asks for the unsettled
    case.
    """
    payload = {
        "id": event_id,
        "type": COMPLETED_EVENT,
        "order_id": order_id,
        "checkout_session_id": session_id,
        "payment_intent": "pi_test_webhook",
        "amount_total": order_total_minor(client, order_id),
        "currency": "usd",
        "payment_status": "paid",
    }
    payload.update(extra)
    return payload


def stock_levels(engine, variant_id):
    with Session(engine) as db:
        stock = db.get(Inventory, variant_id)
        return (stock.available, stock.reserved)


def reservation_statuses(engine, order_id):
    with Session(engine) as db:
        return list(db.scalars(select(Reservation.status).where(Reservation.order_id == order_id)))


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
        )


def payment_event_names(engine, order_id):
    """Sorted: payment events carry opaque ids, not a sequence the tests may rely on."""
    with Session(engine) as db:
        payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
        return sorted(
            db.scalars(select(PaymentEvent.event).where(PaymentEvent.payment_id == payment.id))
        )


def audit_actions(engine, entity_id):
    with Session(engine) as db:
        return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id)))


def row_count(engine, model):
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(model))


def event_state(engine, external_id):
    with Session(engine) as db:
        event = db.scalar(select(WebhookEvent).where(WebhookEvent.external_id == external_id))
        if event is None:
            return None
        return dict(
            provider=event.provider,
            external_id=event.external_id,
            status=event.status,
            attempts=event.attempts,
            payload=event.payload,
            received_at=event.received_at,
            processed_at=event.processed_at,
        )


def test_completed_event_confirms_the_payment_and_consumes_the_reservation(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)
    payload = completed_payload(
        client, payable_order["id"], stripe_checkout.session_id, "evt_completed"
    )
    # Only the value Stripe sends once the money is captured settles the order.
    assert payload["payment_status"] == "paid"

    response = webhook(client, payload)

    assert response.status_code == 200
    assert response.json() == {
        "status": "processed",
        "event_id": "evt_completed",
        "order_id": payable_order["id"],
    }
    state = order_state(engine, payable_order["id"])
    assert (state["status"], state["paid_at"] is not None, state["expires_at"]) == (
        "paid",
        True,
        None,
    )
    assert reservation_statuses(engine, payable_order["id"]) == ["consumed"]
    # The quantity left `available` when the order was created; confirming only converts the
    # hold into a sale, so `available` stays put and `reserved` drops.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    money = money_state(engine, payable_order["id"])
    assert (money["status"], money["payment_intent"]) == ("succeeded", "pi_test_webhook")
    recorded = event_state(engine, "evt_completed")
    assert (recorded["provider"], recorded["status"], recorded["attempts"]) == (
        "stripe",
        "processed",
        0,
    )
    assert recorded["received_at"] is not None and recorded["processed_at"] is not None
    assert recorded["payload"] == payload


@pytest.mark.parametrize("payment_status", ["unpaid", "no_payment_required"])
def test_a_completed_checkout_that_did_not_settle_money_never_marks_the_order_paid(
    commerce, variant, payable_order, stripe_checkout, caplog, payment_status
):
    """``completed`` says the customer finished the session, not that money arrived.

    An asynchronous method (a bank debit, for instance) completes the session while
    ``payment_status`` is still ``unpaid``, and ``checkout.session.async_payment_succeeded``
    or ``...failed`` decides the outcome afterwards. Settling here would consume the hold and
    report a sale nobody has paid for, so the event is acknowledged, recorded and logged.
    """
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    before = stock_levels(engine, variant["id"])
    assert before == (SEEDED_AVAILABLE - 1, 1)
    payload = completed_payload(
        client,
        payable_order["id"],
        stripe_checkout.session_id,
        f"evt_{payment_status}",
        payment_status=payment_status,
    )

    with caplog.at_level("INFO", logger="commerce"):
        response = webhook(client, payload)

    # A 2xx: a 5xx would make Stripe redeliver an event this store handled correctly, and
    # ``failed`` would claim the store could not process something it decided not to act on.
    assert response.status_code == 200
    assert response.json() == {
        "status": "ignored",
        "event_id": f"evt_{payment_status}",
        "order_id": None,
    }
    state = order_state(engine, payable_order["id"])
    assert (state["status"], state["paid_at"]) == ("pending_payment", None)
    # The reservation deadline is still the sweep's business, and the hold is untouched.
    assert state["expires_at"] is not None
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert stock_levels(engine, variant["id"]) == before
    assert money_state(engine, payable_order["id"])["status"] == "requires_payment"
    assert "payment_confirmed" not in audit_actions(engine, payable_order["id"])
    recorded = event_state(engine, f"evt_{payment_status}")
    # Recorded for audit and never marked as a delivered action: ``processed_at`` marks when
    # the store stopped owing an answer, and this event never had one.
    assert (recorded["status"], recorded["processed_at"], recorded["attempts"]) == (
        "ignored",
        None,
        0,
    )
    assert recorded["payload"] == payload
    # The operator can see that a checkout finished without the money, and which value said so.
    hints = [
        json.loads(record.message)
        for record in caplog.records
        if record.name == "commerce.webhooks"
    ]
    assert hints == [
        {
            "event": "webhook_checkout_unpaid",
            "event_id": f"evt_{payment_status}",
            "type": COMPLETED_EVENT,
            "payment_status": payment_status,
        }
    ]


def test_a_repeated_delivery_of_one_event_changes_nothing(
    commerce, variant, payable_order, stripe_checkout, monkeypatch
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    payload = completed_payload(
        client, payable_order["id"], stripe_checkout.session_id, "evt_repeated"
    )
    assert webhook(client, payload).json()["status"] == "processed"
    paid_at = order_state(engine, payable_order["id"])["paid_at"]
    processed_at = event_state(engine, "evt_repeated")["processed_at"]

    def refuse(*_args, **_kwargs):
        raise AssertionError("a duplicate delivery must not run the business action again")

    # The falsifier: if the second delivery reached the payment path at all, the delivery
    # below would be recorded (and answered) as a failure instead of a duplicate.
    monkeypatch.setattr(webhooks, "confirm_payment", refuse)
    second = webhook(client, payload)

    assert second.status_code == 200
    assert second.json()["status"] == "duplicate"
    assert row_count(engine, WebhookEvent) == 1
    recorded = event_state(engine, "evt_repeated")
    assert (recorded["status"], recorded["processed_at"], recorded["attempts"]) == (
        "processed",
        processed_at,
        0,
    )
    assert order_state(engine, payable_order["id"])["paid_at"] == paid_at
    assert reservation_statuses(engine, payable_order["id"]) == ["consumed"]
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert audit_actions(engine, variant["id"]).count("inventory_consumed") == 1
    assert audit_actions(engine, payable_order["id"]).count("payment_confirmed") == 1


def test_events_naming_nothing_local_are_acknowledged_as_ignored(commerce):
    client, engine = commerce
    unknown_session = webhook(
        client,
        {
            "id": "evt_unknown_session",
            "type": COMPLETED_EVENT,
            "checkout_session_id": "cs_test_never_opened",
            "payment_intent": "pi_test_unknown",
            "amount_total": 12900,
            "currency": "usd",
            "payment_status": "paid",
        },
    )
    unknown_order = webhook(
        client,
        {
            "id": "evt_unknown_order",
            "type": COMPLETED_EVENT,
            "order_id": str(uuid4()),
            "checkout_session_id": "cs_test_never_opened",
            "amount_total": 12900,
            "currency": "usd",
            "payment_status": "paid",
        },
    )

    # A 5xx here would make Stripe retry a mismatch forever, so it is a 2xx decision.
    for response, event_id in (
        (unknown_session, "evt_unknown_session"),
        (unknown_order, "evt_unknown_order"),
    ):
        assert response.status_code == 200
        assert response.json()["status"] == "ignored"
        assert event_state(engine, event_id)["status"] == "ignored"
    assert row_count(engine, Payment) == 0
    assert row_count(engine, Order) == 0


def test_expired_event_is_recorded_without_releasing_the_hold(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    before = stock_levels(engine, variant["id"])
    assert before == (SEEDED_AVAILABLE - 1, 1)

    response = webhook(
        client,
        {
            "id": "evt_expired",
            "type": EXPIRED_EVENT,
            "order_id": payable_order["id"],
            "checkout_session_id": stripe_checkout.session_id,
            "currency": "usd",
            # An expired session is usually still unpaid; the type alone is what makes this
            # an ignore, whatever the money state says.
            "payment_status": "unpaid",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
    assert event_state(engine, "evt_expired")["status"] == "ignored"
    # Release has exactly two owners, the expiry sweep and customer cancellation; Stripe's
    # own expiry must not become a third, so nothing here moves the stock or the order.
    assert order_state(engine, payable_order["id"])["status"] == "pending_payment"
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert stock_levels(engine, variant["id"]) == before
    assert "inventory_released" not in audit_actions(engine, variant["id"])


def test_a_processing_failure_rolls_back_its_writes_and_stays_retryable(
    commerce, variant, payable_order, stripe_checkout, monkeypatch, caplog
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    payload = completed_payload(
        client, payable_order["id"], stripe_checkout.session_id, "evt_failing"
    )
    real_confirm = webhooks.confirm_payment
    fail = {"on": True}

    def half_done(db, **kwargs):
        if not fail["on"]:
            return real_confirm(db, **kwargs)
        # A business action that wrote something and then failed: the write must not outlive
        # the failure, or a retry would build on an inconsistent reservation.
        db.execute(
            update(Inventory).where(Inventory.variant_id == variant["id"]).values(reserved=0)
        )
        raise RuntimeError("simulated processing failure")

    monkeypatch.setattr(webhooks, "confirm_payment", half_done)
    with caplog.at_level("INFO", logger="commerce"):
        failed = webhook(client, payload)

    assert failed.status_code >= 500
    assert failed.json() == {
        "code": "webhook_processing_failed",
        "detail": "The event could not be processed",
    }
    recorded = event_state(engine, "evt_failing")
    assert (recorded["status"], recorded["attempts"], recorded["processed_at"]) == (
        "failed",
        1,
        None,
    )
    # The partial business write is gone, and the order is exactly where it was.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)
    assert order_state(engine, payable_order["id"])["status"] == "pending_payment"
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert "simulated processing failure" not in failed.text + caplog.text

    fail["on"] = False
    retried = webhook(client, payload)

    assert retried.status_code == 200
    assert retried.json()["status"] == "processed"
    recorded = event_state(engine, "evt_failing")
    # `attempts` counts failed deliveries, so a row that succeeded on its retry keeps the
    # record of how many retries it took.
    assert (recorded["status"], recorded["attempts"], recorded["processed_at"] is not None) == (
        "processed",
        1,
        True,
    )
    assert order_state(engine, payable_order["id"])["status"] == "paid"
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)


def test_only_the_projected_fields_are_stored(commerce, payable_order, stripe_checkout, caplog):
    client, engine = commerce
    session_post(client, payable_order["id"])
    personal = "buyer@example.com"
    payload = completed_payload(
        client,
        payable_order["id"],
        stripe_checkout.session_id,
        "evt_projected",
        email=personal,
        customer_details={"email": personal, "name": "Test Buyer"},
        payment_method_types=["card"],
        billing_address={"line1": "1 Test Street"},
        receipt_url="https://pay.stripe.com/receipts/private",
    )

    with caplog.at_level("INFO", logger="commerce"):
        response = webhook(client, payload)

    assert response.status_code == 200
    stored = event_state(engine, "evt_projected")["payload"]
    assert set(stored) == PROJECTION_FIELDS
    assert stored["id"] == "evt_projected"
    assert stored["amount_total"] == payload["amount_total"]
    for secret in (personal, "4242", "1 Test Street", "receipts/private", "Test Buyer"):
        assert secret not in json.dumps(stored) + caplog.text + response.text


def test_an_unsupported_event_type_is_recorded_and_ignored(commerce):
    client, engine = commerce

    response = webhook(
        client,
        {
            "id": "evt_intent",
            "type": "payment_intent.succeeded",
            "payment_intent": "pi_test_intent",
            "amount_total": 12900,
            "currency": "usd",
            # The money state is required on every forwarded event, session or not, and a
            # succeeded PaymentIntent is a settled one.
            "payment_status": "paid",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
    assert event_state(engine, "evt_intent")["status"] == "ignored"
    assert row_count(engine, Order) == 0


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"type": COMPLETED_EVENT, "payment_status": "paid"}, id="missing-id"),
        pytest.param({"id": "", "type": COMPLETED_EVENT, "payment_status": "paid"}, id="empty-id"),
        pytest.param(
            {"id": "evt_" + "x" * 200, "type": COMPLETED_EVENT, "payment_status": "paid"},
            id="oversized-id",
        ),
        pytest.param(
            {"id": "evt_boundary", "type": "t" * 81, "payment_status": "paid"},
            id="oversized-type",
        ),
        pytest.param({"id": "evt_boundary", "payment_status": "paid"}, id="missing-type"),
        # The money state is part of the contract: the Next route has to forward it, and a
        # payload that leaves it out would make a completion whose money never arrived look
        # exactly like one whose money did.
        pytest.param({"id": "evt_boundary", "type": COMPLETED_EVENT}, id="missing-payment-status"),
        pytest.param(
            {
                "id": "evt_boundary",
                "type": COMPLETED_EVENT,
                "payment_status": "settled",
            },
            id="unknown-payment-status",
        ),
        pytest.param(
            {
                "id": "evt_boundary",
                "type": COMPLETED_EVENT,
                "payment_status": "paid",
                "order_id": "not-a-uuid",
            }
        ),
        pytest.param(
            {
                "id": "evt_boundary",
                "type": COMPLETED_EVENT,
                "payment_status": "paid",
                "currency": "USD",
            }
        ),
        pytest.param(
            {
                "id": "evt_boundary",
                "type": COMPLETED_EVENT,
                "payment_status": "paid",
                "currency": "us",
            }
        ),
        pytest.param(
            {
                "id": "evt_boundary",
                "type": COMPLETED_EVENT,
                "payment_status": "paid",
                "amount_total": "one",
            }
        ),
        pytest.param(
            {
                "id": "evt_boundary",
                "type": COMPLETED_EVENT,
                "payment_status": "paid",
                "checkout_session_id": "cs_" + "x" * 200,
            }
        ),
    ],
)
def test_a_malformed_projection_is_rejected_without_recording_anything(commerce, payload):
    client, engine = commerce

    response = webhook(client, payload)

    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "detail": "Request validation failed"}
    assert row_count(engine, WebhookEvent) == 0


def test_the_webhook_endpoint_requires_the_internal_proxy_credential(commerce, monkeypatch):
    client, engine = commerce
    monkeypatch.setattr(settings, "app_env", "production")
    payload = {
        "id": "evt_proxy",
        "type": COMPLETED_EVENT,
        "checkout_session_id": "cs_test_absent",
        "payment_status": "paid",
    }

    # No credential at all: this test's own client presents one by default, so it sends a
    # request the way a stranger reaching the Python origin does.
    del client.headers["X-Internal-Proxy-Secret"]
    missing = client.post("/api/v1/webhooks/stripe", json=payload)
    wrong = client.post(
        "/api/v1/webhooks/stripe", json=payload, headers={"X-Internal-Proxy-Secret": "wrong"}
    )
    correct = client.post(
        "/api/v1/webhooks/stripe",
        json=payload,
        headers={"X-Internal-Proxy-Secret": PROXY_SECRET},
    )

    assert (missing.status_code, wrong.status_code) == (403, 403)
    assert correct.status_code == 200
    # Only the acknowledged delivery was stored: a rejected request never reaches the row.
    assert row_count(engine, WebhookEvent) == 1


def test_the_webhook_endpoint_is_unavailable_without_a_configured_credential(commerce, monkeypatch):
    client, engine = commerce
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "commerce_proxy_secret", "")

    response = webhook(
        client, {"id": "evt_proxy", "type": COMPLETED_EVENT, "payment_status": "paid"}
    )

    assert response.status_code == 503
    assert row_count(engine, WebhookEvent) == 0


def test_the_webhook_endpoint_fails_closed_in_development_too(
    commerce, variant, payable_order, stripe_checkout, monkeypatch, caplog
):
    """An unconfigured credential must never mean "open" on this route (P0-②).

    The rest of ``/api/v1`` deliberately lets an anonymous call through outside production,
    where the Next server is the only caller and a session cookie still owns every cart.
    The webhook is the exception: nothing but the proxy credential stands between the public
    internet and a forged "this order is paid" event, so a missing credential is refused
    here instead of being inherited from the development passthrough.
    """
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    before = stock_levels(engine, variant["id"])
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "commerce_proxy_secret", "")
    payload = completed_payload(
        client, payable_order["id"], stripe_checkout.session_id, "evt_unauthenticated"
    )

    with caplog.at_level("ERROR", logger="commerce.proxy"):
        response = webhook(client, payload)

    assert response.status_code == 503
    # ``app.main`` normalizes every 503 body, so the actionable half of the refusal is the
    # log line: the operator who reads it is the one who can set the credential.
    hints = [
        json.loads(record.message) for record in caplog.records if record.name == "commerce.proxy"
    ]
    assert [hint["event"] for hint in hints] == ["webhook_credential_missing"]
    assert "COMMERCE_PROXY_SECRET" in hints[0]["detail"]
    # Nothing was ingested and no money moved: the forged event left no trace at all.
    assert event_state(engine, "evt_unauthenticated") is None
    assert order_state(engine, payable_order["id"])["status"] == "pending_payment"
    assert reservation_statuses(engine, payable_order["id"]) == ["active"]
    assert stock_levels(engine, variant["id"]) == before
    assert money_state(engine, payable_order["id"])["status"] == "requires_payment"


def test_money_arriving_after_the_release_never_restores_a_buyable_order(
    commerce, variant, payable_order, stripe_checkout
):
    client, engine = commerce
    session_post(client, payable_order["id"])
    assert client.post(f"/api/v1/orders/{payable_order['id']}/cancel").json()["status"] == (
        "cancelled"
    )
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)

    response = webhook(
        client,
        completed_payload(client, payable_order["id"], stripe_checkout.session_id, "evt_late"),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "processed"
    # The order stays cancelled and the money becomes the one signal that this customer is
    # owed a refund; the webhook never attempts the refund itself.
    assert order_state(engine, payable_order["id"])["status"] == "cancelled"
    assert reservation_statuses(engine, payable_order["id"]) == ["released"]
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)
    assert money_state(engine, payable_order["id"])["status"] == "refund_pending"
    assert payment_event_names(engine, payable_order["id"]) == [
        "payment_after_release",
        "payment_session_created",
    ]
