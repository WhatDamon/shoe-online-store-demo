"""Run one bounded refund pass: python -m app.refund_pending.

The compensation entry point of the refund design: money whose refund failed, or that
arrived for an order whose stock had already been released, is retried by replaying this
command. It is safe to run as often as needed: every attempt reuses the per-order
idempotency key, so a replayed pass cannot refund the same order twice.
"""

from app.application.payments import refund_pending_payments
from app.infrastructure.database import SessionLocal

if __name__ == "__main__":
    with SessionLocal() as db, db.begin():
        print(f"Refunded {refund_pending_payments(db)} payments.")
