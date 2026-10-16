"""The cancellation contract: three branches, one stable outcome each.

``POST /orders/{id}/cancel`` is a *fulfilment* action, so it answers on the fulfilment
axis: a reservation that is still held is released (200), an order that is already
released is a 200 idempotent no-op, and an order whose money has settled (``paid`` /
``refunded``) is a business refusal with a stable code that routes the customer to the
refund path. The 409 exists so that "this order cannot be cancelled" is never reported as
``backend_unavailable``, and so the caller can tell a refusal apart from a silent no-op.

The release guard itself is unchanged: an order that still reads ``pending_payment`` while
its money settled must keep raising, because releasing it would put paid-for stock back on
sale. That path is pinned by
``test_payment_confirmation.test_customer_cancel_cannot_release_an_order_whose_money_settled``.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import AuditLog, Inventory, Order, Payment, Reservation

# dc-1001's first variant holds this many sellable units in the seeded catalog.
SEEDED_AVAILABLE = 10


def cancel(client, order_id, **kwargs):
    return client.post(f"/api/v1/orders/{order_id}/cancel", **kwargs)


def order_state(engine, order_id):
    with Session(engine) as db:
        order = db.get(Order, order_id)
        return dict(status=order.status, cancellation_reason=order.cancellation_reason)


def money_status(engine, order_id):
    with Session(engine) as db:
        return db.scalar(select(Payment.status).where(Payment.order_id == order_id))


def stock_levels(engine, variant_id):
    with Session(engine) as db:
        stock = db.get(Inventory, variant_id)
        return (stock.available, stock.reserved)


def reservation_statuses(engine, order_id):
    with Session(engine) as db:
        return list(db.scalars(select(Reservation.status).where(Reservation.order_id == order_id)))


def audit_count(engine, action, entity_id=None):
    with Session(engine) as db:
        statement = select(AuditLog.action).where(AuditLog.action == action)
        if entity_id is not None:
            statement = statement.where(AuditLog.entity_id == entity_id)
        return len(list(db.scalars(statement)))


def test_cancel_releases_the_stock_of_a_pending_order(commerce, variant, payable_order):
    client, engine = commerce
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 1)

    response = cancel(client, payable_order["id"])

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert order_state(engine, payable_order["id"])["cancellation_reason"] == "customer_cancelled"
    # Released exactly once: the hold is back on sale and the reservation is closed.
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)
    assert reservation_statuses(engine, payable_order["id"]) == ["released"]
    assert audit_count(engine, "inventory_released") == 1
    assert audit_count(engine, "order_cancelled", payable_order["id"]) == 1


def test_cancel_of_an_already_cancelled_order_stays_idempotent(commerce, variant, payable_order):
    client, engine = commerce
    first = cancel(client, payable_order["id"])

    second = cancel(client, payable_order["id"])

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json() == second.json()
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE, 0)
    assert audit_count(engine, "inventory_released") == 1
    assert audit_count(engine, "order_cancelled", payable_order["id"]) == 1


def test_cancel_of_a_paid_order_is_a_business_refusal(commerce, variant, paid_order):
    client, engine = commerce
    before = (
        order_state(engine, paid_order["id"]),
        money_status(engine, paid_order["id"]),
        stock_levels(engine, variant["id"]),
        reservation_statuses(engine, paid_order["id"]),
    )

    response = cancel(client, paid_order["id"])

    assert response.status_code == 409
    assert response.json() == {
        "code": "order_not_cancellable",
        "detail": "This order can no longer be cancelled",
    }
    # Refusing is only half of it: hand-over stock must not move and the sale must stand.
    assert (
        order_state(engine, paid_order["id"]),
        money_status(engine, paid_order["id"]),
        stock_levels(engine, variant["id"]),
        reservation_statuses(engine, paid_order["id"]),
    ) == before
    assert money_status(engine, paid_order["id"]) == "succeeded"
    assert audit_count(engine, "inventory_released") == 0


def test_cancel_of_a_refunded_order_is_a_business_refusal(
    commerce, variant, paid_order, stripe_checkout
):
    client, engine = commerce
    assert client.post(f"/api/v1/orders/{paid_order['id']}/refund").json()["status"] == "refunded"

    response = cancel(client, paid_order["id"])

    assert response.status_code == 409
    assert response.json() == {
        "code": "order_not_cancellable",
        "detail": "This order can no longer be cancelled",
    }
    assert order_state(engine, paid_order["id"])["status"] == "refunded"
    assert money_status(engine, paid_order["id"]) == "refunded"
    assert stock_levels(engine, variant["id"]) == (SEEDED_AVAILABLE - 1, 0)
    assert audit_count(engine, "inventory_released") == 0


def test_cancel_of_an_order_whose_refund_is_pending_stays_idempotent(
    commerce, variant, refund_pending_order
):
    client, engine = commerce
    # Released first, money captured afterwards: the order is already cancelled, so a
    # second cancellation is a no-op that must not touch the stock or the owed refund.
    before = stock_levels(engine, variant["id"])

    response = cancel(client, refund_pending_order["id"])

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert money_status(engine, refund_pending_order["id"]) == "refund_pending"
    assert stock_levels(engine, variant["id"]) == before
    assert reservation_statuses(engine, refund_pending_order["id"]) == ["released"]
    assert audit_count(engine, "inventory_released") == 1
