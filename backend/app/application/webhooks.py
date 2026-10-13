"""Webhook ingestion: the one place a Stripe delivery may change local state.

The Next public route verifies the event's signature and forwards a *projection* of it, so
the raw body never reaches Python and the payload stored here can only ever hold the fields
this module acts on. Two rules shape everything below:

* **One event id changes state at most once.** The unique ``(provider, external_id)`` row is
  the claim on a delivery: whoever inserts it owns it. A delivery of an id that already
  reached a terminal status is acknowledged without running the business action again, while
  a delivery recorded as ``received`` (the process died mid-flight) or ``failed`` is retried
  rather than dropped.
* **A failed delivery is never reported as success.** Money this store could not record has
  to be redelivered by Stripe, so this is the only module whose failure is passed through as
  a non-2xx instead of being folded into the proxy's ``backend_unavailable``.
* **A completed session is not settled money.** The projection carries the session's
  ``payment_status`` and only ``paid`` confirms the order: an asynchronous method completes
  the session before the money moves, so an ``unpaid`` completion is recorded, logged and
  acknowledged, and Stripe's own later outcome event decides what happens.

The business action runs inside a savepoint and the event's own status is written outside
it, so a business action that stopped halfway leaves no writes behind while the failed
attempt still survives; both parts then commit together with the caller's transaction.

Amounts and currency are stored for reconciliation only: no local price, total or status is
ever taken from the event.
"""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.application.payments import confirm_payment
from app.domain.models import Payment, WebhookEvent
from app.schemas.commerce import StripeEventProjection

PROVIDER = "stripe"
COMPLETED_EVENT = "checkout.session.completed"
EXPIRED_EVENT = "checkout.session.expired"

# The one ``payment_status`` that means the money was captured. ``unpaid`` is what an
# asynchronous method (a bank debit, for instance) reports when the customer finished the
# session before the money moved, and ``no_payment_required`` means nothing was owed.
PAID_PAYMENT_STATUS = "paid"

# An event id is finished once it reaches one of these. ``received`` and ``failed`` are the
# opposite: the first says an earlier delivery never got to write its decision, the second
# says the decision was a failure, and both mean the delivery has to be retried.
TERMINAL_STATUSES = ("processed", "ignored")

logger = logging.getLogger("commerce.webhooks")


@dataclass(frozen=True)
class IngestResult:
    """What one delivery did, and the order it named when there was one."""

    status: str  # 'processed' | 'duplicate' | 'ignored' | 'failed'
    event_id: str
    order_id: str | None = None


def _log_event(level: int, event: str, **fields: str | int) -> None:
    try:
        logger.log(level, json.dumps(dict(event=event, **fields)))
    except Exception:
        # Observability is best-effort: a broken handler must not change the outcome the
        # caller depends on. Only identifiers and the failure type reach this line.
        pass


def ingest_event(db: Session, projection: StripeEventProjection) -> IngestResult:
    """Record one projected event and act on it, exactly once per event id.

    Runs in the caller's transaction. The claim is an insert that ignores a duplicate key,
    so two deliveries of one id can never both proceed: the loser reads the row the winner
    wrote and reports what state it reached.
    """
    now = datetime.now(UTC)
    if not _claim(db, projection, now):
        existing = db.scalar(
            select(WebhookEvent.status).where(
                WebhookEvent.provider == PROVIDER, WebhookEvent.external_id == projection.id
            )
        )
        if existing is None:
            # A delivery that conflicted with a row it cannot read back: acknowledge nothing
            # and let Stripe retry, rather than drop an event this store cannot account for.
            _log_event(logging.ERROR, "webhook_event_unreadable", event_id=projection.id)
            return IngestResult(status="failed", event_id=projection.id)
        if existing in TERMINAL_STATUSES:
            return IngestResult(status="duplicate", event_id=projection.id)
    return _process(db, projection, now)


def _claim(db: Session, projection: StripeEventProjection, now: datetime) -> bool:
    """Insert the event id, ignoring a repeat; True when this delivery owns it.

    Written the way ``lock_cart`` writes its own upsert: the two supported dialects spell the
    conflict clause differently, and the no-target form is the one both accept.
    """
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    result = db.execute(
        insert(WebhookEvent)
        .values(
            provider=PROVIDER,
            external_id=projection.id,
            payload=projection.model_dump(mode="json"),
            status="received",
            attempts=0,
            received_at=now,
        )
        .on_conflict_do_nothing()
    )
    return result.rowcount == 1  # type: ignore[attr-defined]


def _process(db: Session, projection: StripeEventProjection, now: datetime) -> IngestResult:
    try:
        # Savepoint: the business action is all-or-nothing even though its outcome is
        # recorded on the event row outside this block.
        with db.begin_nested():
            status, order_id = _decide(db, projection)
    except Exception as error:
        _record_failure(db, projection.id)
        _log_event(
            logging.ERROR,
            "webhook_failed",
            event_id=projection.id,
            type=projection.type,
            reason=type(error).__name__,
        )
        return IngestResult(status="failed", event_id=projection.id)
    _record_outcome(db, projection.id, status, now)
    return IngestResult(status=status, event_id=projection.id, order_id=order_id)


def _decide(db: Session, projection: StripeEventProjection) -> tuple[str, str | None]:
    """Decide what one delivery means, and return the status to record with the order."""
    if projection.type == COMPLETED_EVENT:
        return _confirm(db, projection)
    if projection.type == EXPIRED_EVENT:
        # Recorded and nothing else. A hold leaves inventory on exactly two paths -- the
        # expiry sweep and customer cancellation -- and the order's own ``expires_at``
        # already covers the same deadline, so Stripe's expiry must not become a third.
        return "ignored", None
    # Any other type is recorded for audit and never acted on.
    return "ignored", None


def _confirm(db: Session, projection: StripeEventProjection) -> tuple[str, str | None]:
    if projection.payment_status != PAID_PAYMENT_STATUS:
        # ``completed`` says the customer finished, not that money arrived. Settling on it
        # would consume the hold and report a sale nobody has paid for, and the later
        # ``checkout.session.async_payment_succeeded``/``...failed`` would find an order it
        # can no longer correct. The event is recorded for audit and answered with a 2xx:
        # a 5xx would make Stripe redeliver a delivery this store handled correctly, and
        # ``failed`` would claim a failure that never happened. The log line is what tells an
        # operator a checkout finished without the money; it carries no state and no detail
        # beyond the event's own identifiers.
        _log_event(
            logging.WARNING,
            "webhook_checkout_unpaid",
            event_id=projection.id,
            type=projection.type,
            payment_status=projection.payment_status,
        )
        return "ignored", None
    named = _named_payment(db, projection)
    if named is None:
        # A session this store never opened, or a replay from another environment. An
        # acknowledgement is the only safe answer: a 5xx here would make Stripe retry a
        # mismatch forever, turning one wrong key into a permanent stream of failures.
        return "ignored", None
    order_id, provider_reference = named
    outcome = confirm_payment(
        db,
        order_id=order_id,
        provider_reference=provider_reference,
        payment_intent=projection.payment_intent,
    )
    # ``confirm_payment`` owns every branch, including the replayed session that belongs to
    # another order; this layer only records which one it took.
    return ("ignored" if outcome.status == "ignored" else "processed"), outcome.order_id


def _named_payment(db: Session, projection: StripeEventProjection) -> tuple[str, str] | None:
    """Resolve the order and the payment session this event names, when both exist locally."""
    reference = projection.checkout_session_id or None
    order_id = str(projection.order_id) if projection.order_id is not None else None
    if order_id is None and reference is not None:
        order_id = db.scalar(
            select(Payment.order_id).where(Payment.provider_reference == reference)
        )
    if order_id is not None and reference is None:
        reference = db.scalar(
            select(Payment.provider_reference).where(Payment.order_id == order_id)
        )
    if order_id is None or reference is None:
        return None
    return order_id, reference


def _record_outcome(db: Session, external_id: str, status: str, now: datetime) -> None:
    """Write the decision on the event row.

    ``processed_at`` marks when the store stopped owing an answer for this event, so it is
    written only for a delivered business action: an ignored event never had one.
    """
    db.execute(
        update(WebhookEvent)
        .where(WebhookEvent.provider == PROVIDER, WebhookEvent.external_id == external_id)
        .values(status=status, processed_at=now if status == "processed" else None)
    )


def _record_failure(db: Session, external_id: str) -> None:
    """Keep the failed attempt on the row that Stripe will deliver again.

    Only failures move the counter, exactly like the refund path's attempt rows: a row
    reading ``processed`` with ``attempts`` above zero says how many retries it took, and a
    ``failed`` row says how many times the delivery has failed so far.
    """
    db.execute(
        update(WebhookEvent)
        .where(WebhookEvent.provider == PROVIDER, WebhookEvent.external_id == external_id)
        .values(status="failed", attempts=WebhookEvent.attempts + 1)
    )
