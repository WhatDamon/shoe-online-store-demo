"""Bounded sweeps, one transaction per order; safe alongside cancellation/other workers."""

import asyncio
import json
import logging
from datetime import UTC, datetime

from sqlalchemy import select
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


def expire_due_orders(
    sessions: sessionmaker[Session] = SessionLocal,
    *,
    now: datetime | None = None,
    batch_size: int | None = None,
) -> int:
    cutoff = as_utc(now or datetime.now(UTC))
    # Close this read transaction before acquiring any write locks (SQLite WAL).
    try:
        with sessions() as db:
            candidates = db.execute(
                select(Order.id, Order.cart_id)
                .where(
                    Order.status == "pending_payment",
                    Order.expires_at <= cutoff,
                )
                .order_by(Order.expires_at, Order.id)
                .limit(batch_size or settings.reservation_sweep_batch_size)
            ).all()
    except Exception:
        _log_event(logging.ERROR, "reservation_sweep_failed")
        raise RuntimeError("Reservation sweep candidate query failed") from None
    expired = 0
    failed = 0
    for order_id, cart_id in candidates:
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
    if expired:
        _log_event(logging.INFO, "reservations_expired", orders=expired)
    if failed:
        # Preserve the CLI/worker failure signal after recording partial progress.
        # Never chain the original exception: tracebacks may expose DB credentials.
        raise RuntimeError(f"Reservation sweep failed for {failed} orders") from None
    return expired


async def expiry_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(expire_due_orders)
        except Exception:
            # A transient DB outage must not silently kill cleanup until restart.
            # Database exceptions may contain connection strings or bound values.
            _log_event(logging.ERROR, "reservation_sweep_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.reservation_sweep_seconds)
        except TimeoutError:
            pass
