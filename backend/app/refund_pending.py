"""Run one bounded refund pass: python -m app.refund_pending.

The compensation entry point of the refund design: money whose refund failed, or that
arrived for an order whose stock had already been released, is retried by replaying this
command. It is safe to run as often as needed: every attempt reuses the per-order
idempotency key, so a replayed pass cannot refund the same order twice. The pass owns its
own sessions and commits each attempt, so this command opens no transaction of its own.
"""

from app.application.payments import refund_pending_payments

if __name__ == "__main__":
    print(f"Refunded {refund_pending_payments()} payments.")
