"""Bounded sweeps, one transaction per order; safe alongside cancellation/other workers."""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.application.commerce import as_utc, expire_if_due, lock_cart, owned_order
from app.config import settings
from app.domain.models import Order
from app.infrastructure.database import SessionLocal

logger = logging.getLogger("commerce.expiry")


def _log_event(level: int, event: str, **fields: str | int) -> None:
    try:
        logger.log(level, json.dumps(dict(event=event, **fields)))
    except Exception:
        # Observability is best-effort: a broken handler/filter must not change
        # transaction outcomes, hide the safe failure signal or kill the worker.
        pass


@dataclass
class ExpiryCursor:
    """One serial worker/database owns this transient, bounded scan position."""

    after: tuple[datetime, str] | None = None
    cutoff: datetime | None = None


def expire_due_orders(
    sessions: sessionmaker[Session] = SessionLocal,
    *,
    now: datetime | None = None,
    batch_size: int | None = None,
    cursor: ExpiryCursor | None = None,
) -> int:
    limit = settings.reservation_sweep_batch_size if batch_size is None else batch_size
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("Sweep batch size must be an integer from 1 to 1000")
    observed_now = as_utc(now or datetime.now(UTC))
    cutoff = observed_now
    after = None
    if cursor is not None and cursor.cutoff is not None and observed_now >= cursor.cutoff:
        cutoff = cursor.cutoff
        after = cursor.after
    # Freeze each pass so newly due orders cannot keep a failed prefix from
    # being revisited. Publish no progress until the read session closes.
    query = (
        select(Order.id, Order.cart_id, Order.expires_at)
        .where(Order.status == "pending_payment", Order.expires_at <= cutoff)
        .order_by(Order.expires_at, Order.id)
        .limit(limit)
    )
    if after is not None:
        query = query.where(
            or_(
                Order.expires_at > after[0],
                and_(Order.expires_at == after[0], Order.id > after[1]),
            )
        )
    # Close this read transaction before acquiring any write locks (SQLite WAL).
    try:
        with sessions() as db:
            candidates = db.execute(query).all()
    except Exception:
        _log_event(logging.ERROR, "reservation_sweep_failed")
        raise RuntimeError("Reservation sweep candidate query failed") from None
    if cursor is not None:
        cursor.cutoff = cutoff if candidates else None
        cursor.after = after if candidates else None
    expired = 0
    failed = 0
    for order_id, cart_id, deadline in candidates:
        try:
            with sessions() as db:
                with db.begin():
                    lock_cart(db, cart_id)
                    # Re-read AFTER locking: another worker/cancel may have released it.
                    released = expire_if_due(db, owned_order(db, cart_id, order_id), now=cutoff)
                # Count only after commit, but before close: a cleanup failure
                # cannot undo a successfully committed inventory release.
                if released:
                    expired += 1
        except Exception:
            # A transaction OR session cleanup failed; later orders still run.
            # Do not print private DB exception text, values or session IDs.
            failed += 1
            _log_event(logging.ERROR, "reservation_expiry_failed", order_id=order_id)
        # Failed orders remain pending and will retry on wrap; never jump over
        # candidates that have not been attempted if this call is interrupted.
        if cursor is not None:
            cursor.after = (as_utc(deadline), order_id)
    if expired:
        _log_event(logging.INFO, "reservations_expired", orders=expired)
    if failed:
        # Preserve the CLI/worker failure signal after recording partial progress.
        # Never chain the original exception: tracebacks may expose DB credentials.
        raise RuntimeError(f"Reservation sweep failed for {failed} orders") from None
    return expired


async def expiry_loop(stop: asyncio.Event) -> None:
    cursor = ExpiryCursor()
    while not stop.is_set():
        try:
            await asyncio.to_thread(expire_due_orders, cursor=cursor)
        except Exception:
            # A transient DB outage must not silently kill cleanup until restart.
            # Database exceptions may contain connection strings or bound values.
            _log_event(logging.ERROR, "reservation_sweep_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.reservation_sweep_seconds)
        except TimeoutError:
            pass
