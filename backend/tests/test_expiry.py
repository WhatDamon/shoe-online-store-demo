import asyncio
import json
import logging
import runpy
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta, timezone
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.application import commerce as service
from app.application import expiry
from app.application.commerce import as_utc
from app.config import Settings, settings
from app.domain.models import AuditLog, Cart, Inventory, Order, OrderItem, Reservation
from app.main import app, lifespan


def place_order(client, variant, quantity=2, key=None):
    added = client.post(
        "/api/v1/cart/items",
        json={
            "variant_id": variant["id"],
            "quantity": quantity,
        },
    )
    assert added.status_code == 200
    response = client.post(
        "/api/v1/checkout/create-order",
        headers={
            "Idempotency-Key": key or str(uuid4()),
        },
    )
    assert response.status_code == 200
    return response.json()


def set_deadline(engine, order_id, deadline):
    with Session(engine) as db, db.begin():
        db.get(Order, order_id).expires_at = deadline


def assert_released_once(engine, variant, order_id):
    with Session(engine) as db:
        order = db.get(Order, order_id)
        assert order.status == "cancelled"
        assert order.cancellation_reason == "expired"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        reservation = db.scalar(select(Reservation).where(Reservation.order_id == order_id))
        assert reservation.status == "released"
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_id == order_id,
                    AuditLog.action == "order_expired",
                )
            )
            == 1
        )
        released = db.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == variant["id"],
                AuditLog.action == "inventory_released",
            )
        ).all()
        assert len(released) == 1
        assert released[0].details["reason"] == "expired"


def test_new_deadline_is_server_owned_and_immutable_on_retry(commerce, variant, monkeypatch):
    client, engine = commerce
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 60)
    before = datetime.now(UTC)
    order = place_order(client, variant, key="stable-key")
    deadline = datetime.fromisoformat(order["expires_at"])
    assert before + timedelta(seconds=60) <= deadline
    assert deadline <= datetime.now(UTC) + timedelta(seconds=60)
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 3600)
    retry = client.post(
        "/api/v1/checkout/create-order",
        headers={"Idempotency-Key": "stable-key"},
        json={"expires_at": "2099-01-01T00:00:00Z", "status": "paid"},
    ).json()
    assert retry["expires_at"] == order["expires_at"]
    assert retry["id"] == order["id"]
    assert (
        expiry.expire_due_orders(sessionmaker(engine), now=deadline - timedelta(microseconds=1))
        == 0
    )
    assert expiry.expire_due_orders(sessionmaker(engine), now=deadline) == 1
    assert_released_once(engine, variant, order["id"])


@pytest.mark.parametrize("fault", ["missing", "short_reserved"])
def test_sweep_preserves_failed_release_and_continues_healthy_orders(commerce, variant, fault):
    client, engine = commerce
    broken_order = place_order(client, variant)
    other = client.get("/api/v1/catalog/products/dc-1001").json()["variants"][1]
    client.headers["X-Session-ID"] = str(uuid4())
    healthy_order = place_order(client, other, quantity=1)
    cutoff = datetime.now(UTC)
    set_deadline(engine, broken_order["id"], cutoff - timedelta(seconds=2))
    set_deadline(engine, healthy_order["id"], cutoff - timedelta(seconds=1))
    with Session(engine) as db, db.begin():
        stock = db.get(Inventory, variant["id"])
        if fault == "missing":
            db.delete(stock)
        else:
            stock.reserved = 1

    sessions = sessionmaker(engine)
    with pytest.raises(RuntimeError, match="Reservation sweep failed for 1 orders"):
        expiry.expire_due_orders(sessions, now=cutoff)
    with Session(engine) as db:
        broken = db.get(Order, broken_order["id"])
        assert broken.status == "pending_payment"
        assert broken.cancellation_reason is None
        reservation = db.scalar(select(Reservation).where(Reservation.order_id == broken.id))
        assert reservation.status == "active"
        assert db.get(Order, healthy_order["id"]).status == "cancelled"
        healthy_stock = db.get(Inventory, other["id"])
        assert (healthy_stock.available, healthy_stock.reserved) == (10, 0)
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "inventory_released",
                    AuditLog.entity_id == variant["id"],
                )
            )
            == 0
        )

    with Session(engine) as db, db.begin():
        if fault == "missing":
            db.add(Inventory(variant_id=variant["id"], available=8, reserved=2))
        else:
            db.get(Inventory, variant["id"]).reserved = 2
    assert expiry.expire_due_orders(sessions, now=cutoff) == 1
    assert expiry.expire_due_orders(sessions, now=cutoff) == 0
    assert_released_once(engine, variant, broken_order["id"])


@pytest.mark.parametrize("batch_size", [1, 2])
@pytest.mark.parametrize("fault", ["missing", "short_reserved"])
def test_worker_rotates_past_persistent_bad_batch(
    commerce, variant, monkeypatch, batch_size, fault
):
    client, engine = commerce
    bad_orders = [place_order(client, variant, quantity=1) for _ in range(batch_size)]
    other = client.get("/api/v1/catalog/products/dc-1001").json()["variants"][1]
    client.headers["X-Session-ID"] = str(uuid4())
    healthy = place_order(client, other, quantity=1)
    cutoff = datetime.now(UTC)
    for index, order in enumerate(bad_orders):
        set_deadline(engine, order["id"], cutoff - timedelta(seconds=10 - index))
    set_deadline(engine, healthy["id"], cutoff - timedelta(seconds=1))
    with Session(engine) as db, db.begin():
        stock = db.get(Inventory, variant["id"])
        if fault == "missing":
            db.delete(stock)
        else:
            stock.reserved = 0
    sessions = sessionmaker(engine)
    original = expiry.expire_due_orders
    cursors = []
    monkeypatch.setattr(settings, "reservation_sweep_seconds", 0.001)

    async def exercise():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()

        def sweep(*, cursor=None):
            cursors.append(cursor)
            try:
                options = {"cursor": cursor} if cursor is not None else {}
                return original(sessions, now=cutoff, batch_size=batch_size, **options)
            finally:
                if len(cursors) == 3:
                    loop.call_soon_threadsafe(stop.set)

        monkeypatch.setattr(expiry, "expire_due_orders", sweep)
        await asyncio.wait_for(expiry.expiry_loop(stop), timeout=5)

    asyncio.run(exercise())
    with Session(engine) as db:
        assert db.get(Order, healthy["id"]).status == "cancelled"
        for order in bad_orders:
            assert db.get(Order, order["id"]).status == "pending_payment"
            assert (
                db.scalar(select(Reservation).where(Reservation.order_id == order["id"])).status
                == "active"
            )
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_released", AuditLog.entity_id == variant["id"])
            )
            == 0
        )
    assert_released_once(engine, other, healthy["id"])
    assert len(cursors) == 3 and cursors[0] is not None
    assert all(cursor is cursors[0] for cursor in cursors)
    cursor = cursors[0]
    assert cursor.after is None and cursor.cutoff is None
    with Session(engine) as db, db.begin():
        if fault == "missing":
            db.add(
                Inventory(variant_id=variant["id"], available=10 - batch_size, reserved=batch_size)
            )
        else:
            db.get(Inventory, variant["id"]).reserved = batch_size
    assert original(sessions, now=cutoff, batch_size=batch_size, cursor=cursor) == batch_size
    assert original(sessions, now=cutoff, batch_size=batch_size, cursor=cursor) == 0
    assert original(sessions, now=cutoff, batch_size=batch_size, cursor=cursor) == 0
    with Session(engine) as db:
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        assert (
            db.scalar(
                select(func.count()).select_from(AuditLog).where(AuditLog.action == "order_expired")
            )
            == batch_size + 1
        )


def test_cursor_freezes_pass_and_revisits_late_backdated_orders(commerce, variant, monkeypatch):
    client, engine = commerce
    broken, healthy = [place_order(client, variant, quantity=1) for _ in range(2)]
    cutoff = datetime.now(UTC) - timedelta(seconds=10)
    set_deadline(engine, broken["id"], cutoff - timedelta(seconds=2))
    set_deadline(engine, healthy["id"], cutoff - timedelta(seconds=1))
    original = service.audit

    def fail(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired" and entity == broken["id"]:
            raise RuntimeError("private-cursor-marker")

    monkeypatch.setattr(service, "audit", fail)
    cursor = expiry.ExpiryCursor()
    sessions = sessionmaker(engine)
    with pytest.raises(RuntimeError):
        expiry.expire_due_orders(sessions, now=cutoff, batch_size=1, cursor=cursor)
    future, backdated = [place_order(client, variant, quantity=1) for _ in range(2)]
    set_deadline(engine, future["id"], cutoff + timedelta(seconds=1))
    set_deadline(engine, backdated["id"], cutoff - timedelta(seconds=3))
    later = cutoff + timedelta(hours=1)
    assert expiry.expire_due_orders(sessions, now=later, batch_size=1, cursor=cursor) == 1
    assert cursor.cutoff == cutoff
    assert expiry.expire_due_orders(sessions, now=later, batch_size=1, cursor=cursor) == 0
    assert cursor.after is None and cursor.cutoff is None
    with Session(engine) as db:
        assert db.get(Order, future["id"]).status == "pending_payment"
        assert db.get(Order, backdated["id"]).status == "pending_payment"
    monkeypatch.setattr(service, "audit", original)
    assert expiry.expire_due_orders(sessions, now=later, batch_size=1, cursor=cursor) == 1
    assert cursor.after == (cutoff - timedelta(seconds=3), backdated["id"])
    assert expiry.expire_due_orders(sessions, now=later, batch_size=1, cursor=cursor) == 1
    assert expiry.expire_due_orders(sessions, now=later, batch_size=1, cursor=cursor) == 1
    assert expiry.expire_due_orders(sessions, now=later, batch_size=1, cursor=cursor) == 0
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10
        assert (
            db.scalar(
                select(func.count()).select_from(AuditLog).where(AuditLog.action == "order_expired")
            )
            == 4
        )


@pytest.mark.parametrize("offset_hours", [-8, 8, None])
def test_cursor_ties_use_id_and_utc_and_failed_orders_retry(
    commerce, variant, monkeypatch, offset_hours
):
    client, engine = commerce
    orders = sorted(
        [place_order(client, variant, quantity=1) for _ in range(2)], key=lambda order: order["id"]
    )
    deadline = datetime.now(UTC) - timedelta(seconds=1)
    for order in orders:
        set_deadline(engine, order["id"], deadline)
    observed = (
        deadline.replace(tzinfo=None)
        if offset_hours is None
        else deadline.astimezone(timezone(timedelta(hours=offset_hours)))
    )
    original = service.audit

    def fail(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired" and entity == orders[0]["id"]:
            raise RuntimeError("private-tie-marker")

    monkeypatch.setattr(service, "audit", fail)
    cursor = expiry.ExpiryCursor()
    sessions = sessionmaker(engine)
    with pytest.raises(RuntimeError):
        expiry.expire_due_orders(sessions, now=observed, batch_size=1, cursor=cursor)
    assert cursor.after == (deadline, orders[0]["id"])
    assert cursor.cutoff == deadline
    assert expiry.expire_due_orders(sessions, now=observed, batch_size=1, cursor=cursor) == 1
    assert cursor.after == (deadline, orders[1]["id"])
    assert expiry.expire_due_orders(sessions, now=observed, batch_size=1, cursor=cursor) == 0
    monkeypatch.setattr(service, "audit", original)
    assert expiry.expire_due_orders(sessions, now=observed, batch_size=1, cursor=cursor) == 1
    assert expiry.expire_due_orders(sessions, now=observed, batch_size=1, cursor=cursor) == 0
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10


@pytest.mark.parametrize("failure_at", ["open", "execute", "materialize", "close"])
@pytest.mark.parametrize("empty", [False, True])
@pytest.mark.parametrize("state", ["continuing", "fresh", "clock_rollback"])
def test_cursor_read_failure_never_publishes_progress(commerce, variant, failure_at, empty, state):
    client, engine = commerce
    first, second = [place_order(client, variant, quantity=1) for _ in range(2)]
    cutoff = datetime.now(UTC)
    set_deadline(engine, first["id"], cutoff - timedelta(seconds=2))
    set_deadline(
        engine,
        second["id"],
        cutoff + timedelta(seconds=1) if empty else cutoff - timedelta(seconds=1),
    )
    cursor = expiry.ExpiryCursor()
    assert (
        expiry.expire_due_orders(sessionmaker(engine), now=cutoff, batch_size=1, cursor=cursor) == 1
    )
    if state == "fresh":
        cursor = expiry.ExpiryCursor()
        set_deadline(engine, second["id"], cutoff + timedelta(seconds=1) if empty else cutoff)
    elif state == "clock_rollback":
        cutoff -= timedelta(seconds=3)
        set_deadline(engine, second["id"], cutoff + timedelta(seconds=1) if empty else cutoff)
    before = (cursor.after, cursor.cutoff)
    writes = []

    class FailReadSession(Session):
        def __init__(self, *args, **kwargs):
            if failure_at == "open":
                raise RuntimeError("private-read-marker")
            super().__init__(*args, **kwargs)

        def execute(self, *args, **kwargs):
            if failure_at == "execute":
                raise RuntimeError("private-read-marker")
            result = super().execute(*args, **kwargs)
            if failure_at == "materialize":

                class FailRows:
                    def all(self):
                        raise RuntimeError("private-read-marker")

                return FailRows()
            return result

        def begin(self, *args, **kwargs):
            writes.append(1)
            return super().begin(*args, **kwargs)

        def close(self):
            super().close()
            if failure_at == "close":
                raise RuntimeError("private-read-marker")

    with pytest.raises(RuntimeError, match="Reservation sweep candidate query failed") as caught:
        expiry.expire_due_orders(
            sessionmaker(engine, class_=FailReadSession), now=cutoff, batch_size=1, cursor=cursor
        )
    assert (cursor.after, cursor.cutoff) == before
    assert writes == []
    assert "private-read-marker" not in "".join(traceback.format_exception(caught.value))
    with Session(engine) as db:
        assert db.get(Order, second["id"]).status == "pending_payment"


def test_cursor_clock_rollback_restarts_without_releasing_future_order(commerce, variant):
    client, engine = commerce
    first, second = [place_order(client, variant, quantity=1) for _ in range(2)]
    cutoff = datetime.now(UTC)
    set_deadline(engine, first["id"], cutoff - timedelta(seconds=2))
    set_deadline(engine, second["id"], cutoff - timedelta(seconds=1))
    cursor = expiry.ExpiryCursor()
    sessions = sessionmaker(engine)
    assert expiry.expire_due_orders(sessions, now=cutoff, batch_size=1, cursor=cursor) == 1
    assert (
        expiry.expire_due_orders(
            sessions, now=cutoff - timedelta(seconds=3), batch_size=1, cursor=cursor
        )
        == 0
    )
    assert cursor.after is None and cursor.cutoff is None
    with Session(engine) as db:
        assert db.get(Order, second["id"]).status == "pending_payment"
    assert expiry.expire_due_orders(sessions, now=cutoff, batch_size=1, cursor=cursor) == 1


@pytest.mark.parametrize("batch_size", [0, -1, 1.0, "1", True, False, 1001])
def test_invalid_batch_is_rejected_before_session_or_cursor_mutation(batch_size):
    cursor = expiry.ExpiryCursor()
    calls = []

    def sessions():
        calls.append(1)
        raise AssertionError("Database must not be opened")

    with pytest.raises(ValueError, match="Sweep batch size must be an integer from 1 to 1000"):
        expiry.expire_due_orders(sessions, batch_size=batch_size, cursor=cursor)
    assert calls == []
    assert cursor.after is None and cursor.cutoff is None


def test_cursor_never_skips_unattempted_suffix_after_interrupt(commerce, variant, monkeypatch):
    client, engine = commerce
    orders = [place_order(client, variant, quantity=1) for _ in range(3)]
    cutoff = datetime.now(UTC)
    for index, order in enumerate(orders):
        set_deadline(engine, order["id"], cutoff - timedelta(seconds=3 - index))
    cursor = expiry.ExpiryCursor()
    original = service.audit

    class Interrupted(BaseException):
        pass

    def interrupt(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired" and entity == orders[1]["id"]:
            raise Interrupted()

    monkeypatch.setattr(service, "audit", interrupt)
    sessions = sessionmaker(engine)
    with pytest.raises(Interrupted):
        expiry.expire_due_orders(sessions, now=cutoff, batch_size=3, cursor=cursor)
    assert cursor.after == (cutoff - timedelta(seconds=3), orders[0]["id"])
    with Session(engine) as db:
        assert db.get(Order, orders[0]["id"]).status == "cancelled"
        assert all(db.get(Order, order["id"]).status == "pending_payment" for order in orders[1:])
    monkeypatch.setattr(service, "audit", original)
    assert expiry.expire_due_orders(sessions, now=cutoff, batch_size=3, cursor=cursor) == 2
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10
        assert (
            db.scalar(
                select(func.count()).select_from(AuditLog).where(AuditLog.action == "order_expired")
            )
            == 3
        )


def test_cursor_advances_over_candidate_cancelled_after_read(commerce, variant):
    client, engine = commerce
    first, second = [place_order(client, variant, quantity=1) for _ in range(2)]
    cutoff = datetime.now(UTC)
    set_deadline(engine, first["id"], cutoff - timedelta(seconds=2))
    set_deadline(engine, second["id"], cutoff - timedelta(seconds=1))
    cancelled = []

    class CancelAfterReadSession(Session):
        def close(self):
            super().close()
            if not cancelled:
                cancelled.append(1)
                assert client.post(f"/api/v1/orders/{first['id']}/cancel").status_code == 200

    cursor = expiry.ExpiryCursor()
    sessions = sessionmaker(engine, class_=CancelAfterReadSession)
    assert expiry.expire_due_orders(sessions, now=cutoff, batch_size=1, cursor=cursor) == 0
    assert cursor.after == (cutoff - timedelta(seconds=2), first["id"])
    assert expiry.expire_due_orders(sessions, now=cutoff, batch_size=1, cursor=cursor) == 1
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_released")
            )
            == 2
        )


def test_cursor_lock_recheck_uses_frozen_cutoff_after_deadline_changes(commerce, variant):
    client, engine = commerce
    first, second = [place_order(client, variant, quantity=1) for _ in range(2)]
    cutoff = datetime.now(UTC)
    set_deadline(engine, first["id"], cutoff - timedelta(seconds=2))
    set_deadline(engine, second["id"], cutoff - timedelta(seconds=1))
    cursor = expiry.ExpiryCursor()
    sessions = sessionmaker(engine)
    assert expiry.expire_due_orders(sessions, now=cutoff, batch_size=1, cursor=cursor) == 1
    changed = []

    class ChangeDeadlineAfterReadSession(Session):
        def close(self):
            super().close()
            if not changed:
                changed.append(1)
                set_deadline(engine, second["id"], cutoff + timedelta(minutes=1))

    assert (
        expiry.expire_due_orders(
            sessionmaker(engine, class_=ChangeDeadlineAfterReadSession),
            now=cutoff + timedelta(hours=1),
            batch_size=1,
            cursor=cursor,
        )
        == 0
    )
    assert cursor.after == (cutoff - timedelta(seconds=1), second["id"])
    assert cursor.cutoff == cutoff
    with Session(engine) as db:
        assert db.get(Order, second["id"]).status == "pending_payment"
    assert (
        expiry.expire_due_orders(
            sessions, now=cutoff + timedelta(hours=1), batch_size=1, cursor=cursor
        )
        == 0
    )
    assert (
        expiry.expire_due_orders(
            sessions, now=cutoff + timedelta(hours=1), batch_size=1, cursor=cursor
        )
        == 1
    )
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10


def test_worker_cursor_is_private_and_restart_starts_from_head(monkeypatch):
    cursors = []
    monkeypatch.setattr(settings, "reservation_sweep_seconds", 0.001)

    async def exercise():
        for _ in range(2):
            stop = asyncio.Event()
            loop = asyncio.get_running_loop()

            def sweep(*, cursor, loop=loop, stop=stop):
                assert cursor.after is None and cursor.cutoff is None
                cursors.append(cursor)
                cursor.after = (datetime.now(UTC), str(uuid4()))
                cursor.cutoff = datetime.now(UTC)
                loop.call_soon_threadsafe(stop.set)

            monkeypatch.setattr(expiry, "expire_due_orders", sweep)
            await asyncio.wait_for(expiry.expiry_loop(stop), timeout=5)

    asyncio.run(exercise())
    assert len(cursors) == 2
    assert cursors[0] is not cursors[1]


@pytest.mark.parametrize("offset_hours", [-8, 0, 8, None])
def test_sweep_normalizes_cutoff_before_sql_and_keeps_exact_deadline(
    commerce, variant, offset_hours
):
    client, engine = commerce
    order = place_order(client, variant)
    deadline = datetime(2026, 9, 21, 12, tzinfo=UTC)
    set_deadline(engine, order["id"], deadline)
    sessions = sessionmaker(engine)
    with Session(engine) as db:
        cart_id = db.get(Order, order["id"]).cart_id
        revision = db.get(Cart, cart_id).revision

    def cutoff(instant):
        if offset_hours is None:
            return instant.replace(tzinfo=None)
        return instant.astimezone(timezone(timedelta(hours=offset_hours)))

    assert expiry.expire_due_orders(sessions, now=cutoff(deadline - timedelta(microseconds=1))) == 0
    with Session(engine) as db:
        assert db.get(Cart, cart_id).revision == revision
        assert db.get(Order, order["id"]).status == "pending_payment"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (8, 2)
    assert expiry.expire_due_orders(sessions, now=cutoff(deadline)) == 1
    assert expiry.expire_due_orders(sessions, now=cutoff(deadline)) == 0
    assert_released_once(engine, variant, order["id"])


def test_expired_idempotency_returns_original_order_without_relocking(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant, key="expired-key")
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    # A newly added cart must survive retrying the old order key.
    client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 1})
    response = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": "expired-key"}
    )
    assert response.json()["id"] == order["id"]
    assert response.json()["cancellation_reason"] == "expired"
    assert response.json()["items"] == order["items"]
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 1
    assert_released_once(engine, variant, order["id"])


@pytest.mark.parametrize("endpoint", ["read", "cancel", "payment"])
def test_order_endpoints_expire_due_orders_with_sweeper_disabled(commerce, variant, endpoint):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    path = f"/api/v1/orders/{order['id']}"
    if endpoint == "read":
        response = client.get(path)
    elif endpoint == "cancel":
        response = client.post(path + "/cancel")
    else:
        response = client.post("/api/v1/payments/session", json={"order_id": order["id"]})
        assert response.json()["code"] == "payment_disabled"
        assert response.json()["charged"] is False
    assert response.status_code == 200
    assert_released_once(engine, variant, order["id"])


def test_expiry_keeps_owner_checks(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    assert (
        client.get(
            f"/api/v1/orders/{order['id']}", headers={"X-Session-ID": str(uuid4())}
        ).status_code
        == 404
    )
    with Session(engine) as db:
        assert db.get(Order, order["id"]).status == "pending_payment"


def test_overlapping_workers_and_cancel_release_once(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    sessions = sessionmaker(engine)
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = [pool.submit(expiry.expire_due_orders, sessions) for _ in range(4)]
        cancel = pool.submit(client.post, f"/api/v1/orders/{order['id']}/cancel")
        assert sum(job.result() for job in jobs) <= 1
        assert cancel.result().status_code == 200
    assert expiry.expire_due_orders(sessions) == 0
    assert_released_once(engine, variant, order["id"])


def test_customer_cancelled_orders_keep_reason_and_stock(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    cancelled = client.post(f"/api/v1/orders/{order['id']}/cancel").json()
    assert cancelled["cancellation_reason"] == "customer_cancelled"
    assert (
        expiry.expire_due_orders(sessionmaker(engine), now=datetime.now(UTC) + timedelta(days=1))
        == 0
    )
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10
        assert db.get(Order, order["id"]).cancellation_reason == "customer_cancelled"


def test_bounded_batch_catches_up_and_retains_snapshots(commerce, variant):
    client, engine = commerce
    orders = [place_order(client, variant, quantity=1) for _ in range(3)]
    future = datetime.now(UTC) + timedelta(days=1)
    sessions = sessionmaker(engine)
    assert expiry.expire_due_orders(sessions, now=future, batch_size=2) == 2
    assert expiry.expire_due_orders(sessions, now=future, batch_size=2) == 1
    assert expiry.expire_due_orders(sessions, now=future, batch_size=2) == 0
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(OrderItem)) == 3
        assert db.get(Inventory, variant["id"]).available == 10
        assert all(db.get(Order, order["id"]).status == "cancelled" for order in orders)


def test_expiry_rolls_back_release_and_audit_together(commerce, variant, monkeypatch):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    original = service.audit

    def fail(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired":
            raise HTTPException(500, "injected_failure")

    monkeypatch.setattr(service, "audit", fail)
    with pytest.raises(RuntimeError, match="Reservation sweep failed for 1 orders"):
        expiry.expire_due_orders(sessionmaker(engine))
    with Session(engine) as db:
        assert db.get(Order, order["id"]).status == "pending_payment"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (8, 2)
        assert db.scalar(select(Reservation)).status == "active"
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "inventory_released",
                )
            )
            == 0
        )
    monkeypatch.setattr(service, "audit", original)
    assert expiry.expire_due_orders(sessionmaker(engine)) == 1
    assert_released_once(engine, variant, order["id"])


@pytest.mark.parametrize("failure_index", [0, 1, 2])
def test_sweep_continues_after_one_failure_and_counts_only_commits(
    commerce, variant, monkeypatch, caplog, failure_index
):
    client, engine = commerce
    orders = [place_order(client, variant, quantity=1) for _ in range(3)]
    deadline = datetime(2026, 9, 21, 12, tzinfo=UTC)
    for index, order in enumerate(orders):
        set_deadline(engine, order["id"], deadline + timedelta(seconds=index))
    failed_id = orders[failure_index]["id"]
    original = service.audit

    def fail(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired" and entity == failed_id:
            raise RuntimeError("private-marker postgres://user:password@internal/db")

    caplog.set_level(logging.INFO, logger="commerce.expiry")
    monkeypatch.setattr(service, "audit", fail)
    sessions = sessionmaker(engine)
    cutoff = deadline + timedelta(seconds=3)
    with pytest.raises(RuntimeError):
        expiry.expire_due_orders(sessions, now=cutoff)

    with Session(engine) as db:
        for index, order in enumerate(orders):
            failed = index == failure_index
            assert db.get(Order, order["id"]).status == (
                "pending_payment" if failed else "cancelled"
            )
            reservation = db.scalar(select(Reservation).where(Reservation.order_id == order["id"]))
            assert reservation.status == ("active" if failed else "released")
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (9, 1)
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_released")
            )
            == 2
        )
    events = [
        json.loads(record.message) for record in caplog.records if record.name == "commerce.expiry"
    ]
    assert {"event": "reservations_expired", "orders": 2} in events
    assert {"event": "reservation_expiry_failed", "order_id": failed_id} in events
    assert "private-marker" not in caplog.text
    assert "password" not in caplog.text

    caplog.clear()
    monkeypatch.setattr(service, "audit", original)
    assert expiry.expire_due_orders(sessions, now=cutoff) == 1
    assert expiry.expire_due_orders(sessions, now=cutoff) == 0
    with Session(engine) as db:
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_released")
            )
            == 3
        )


def test_sweep_does_not_count_commit_failure(commerce, variant, caplog):
    client, engine = commerce
    order = place_order(client, variant)
    deadline = datetime(2026, 9, 21, 12, tzinfo=UTC)
    set_deadline(engine, order["id"], deadline)

    class FailCommitSession(Session):
        pass

    def fail_commit(db):
        raise RuntimeError("private-commit-marker")

    event.listen(FailCommitSession, "before_commit", fail_commit)
    caplog.set_level(logging.INFO, logger="commerce.expiry")
    cursor = expiry.ExpiryCursor()
    with pytest.raises(RuntimeError):
        expiry.expire_due_orders(
            sessionmaker(engine, class_=FailCommitSession), now=deadline, cursor=cursor
        )
    assert cursor.after == (deadline, order["id"])
    assert "reservations_expired" not in caplog.text
    assert "private-commit-marker" not in caplog.text
    with Session(engine) as db:
        assert db.get(Order, order["id"]).status == "pending_payment"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (8, 2)
        assert db.scalar(select(Reservation)).status == "active"
    assert expiry.expire_due_orders(sessionmaker(engine), now=deadline) == 1
    assert_released_once(engine, variant, order["id"])


@pytest.fixture(params=["handler", "filter"])
def broken_expiry_logging(request, monkeypatch):
    def fail(*args):
        raise RuntimeError("private-logging-marker")

    handler = logging.Handler()
    monkeypatch.setattr(handler, "emit", fail)
    monkeypatch.setattr(expiry.logger, "handlers", [handler])
    monkeypatch.setattr(expiry.logger, "filters", [fail] if request.param == "filter" else [])
    monkeypatch.setattr(expiry.logger, "level", logging.INFO)


def test_logging_failure_keeps_partial_progress_and_safe_error(
    commerce, variant, monkeypatch, broken_expiry_logging
):
    client, engine = commerce
    orders = [place_order(client, variant, quantity=1) for _ in range(3)]
    deadline = datetime(2026, 9, 21, 12, tzinfo=UTC)
    for index, order in enumerate(orders):
        set_deadline(engine, order["id"], deadline + timedelta(seconds=index))
    original = service.audit

    def fail(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired" and entity == orders[0]["id"]:
            raise RuntimeError("private-database-marker")

    monkeypatch.setattr(service, "audit", fail)
    cursor = expiry.ExpiryCursor()
    with pytest.raises(RuntimeError, match="Reservation sweep failed for 1 orders") as caught:
        expiry.expire_due_orders(
            sessionmaker(engine), now=deadline + timedelta(seconds=3), cursor=cursor
        )
    assert cursor.after == (deadline + timedelta(seconds=2), orders[-1]["id"])
    assert "private" not in "".join(traceback.format_exception(caught.value))
    with Session(engine) as db:
        assert db.get(Order, orders[0]["id"]).status == "pending_payment"
        assert all(db.get(Order, order["id"]).status == "cancelled" for order in orders[1:])
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (9, 1)


def test_logging_failure_does_not_change_success_count(commerce, variant, broken_expiry_logging):
    client, engine = commerce
    order = place_order(client, variant)
    future = datetime.now(UTC) + timedelta(days=1)
    assert expiry.expire_due_orders(sessionmaker(engine), now=future) == 1
    assert_released_once(engine, variant, order["id"])


@pytest.mark.parametrize("failure_at", ["open", "execute", "close"])
def test_candidate_session_failure_has_safe_cli_traceback(
    commerce, variant, monkeypatch, caplog, failure_at
):
    client, engine = commerce
    order = place_order(client, variant)

    class FailReadSession(Session):
        def __init__(self, *args, **kwargs):
            if failure_at == "open":
                raise RuntimeError("private-candidate-marker")
            super().__init__(*args, **kwargs)

        def execute(self, *args, **kwargs):
            if failure_at == "execute":
                raise RuntimeError("private-candidate-marker")
            return super().execute(*args, **kwargs)

        def close(self):
            super().close()
            if failure_at == "close":
                raise RuntimeError("private-candidate-marker")

    original = expiry.expire_due_orders
    monkeypatch.setattr(
        expiry,
        "expire_due_orders",
        lambda: original(
            sessionmaker(engine, class_=FailReadSession),
            now=datetime.now(UTC) + timedelta(days=1),
        ),
    )
    with pytest.raises(RuntimeError, match="Reservation sweep candidate query failed") as caught:
        runpy.run_module("app.expire_orders", run_name="__main__")
    assert "private-candidate-marker" not in "".join(traceback.format_exception(caught.value))
    assert "private-candidate-marker" not in caplog.text
    assert "reservation_sweep_failed" in caplog.text
    with Session(engine) as db:
        assert db.get(Order, order["id"]).status == "pending_payment"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (8, 2)


def test_committed_release_is_counted_before_close_failure(commerce, variant, caplog):
    client, engine = commerce
    orders = [place_order(client, variant, quantity=1) for _ in range(2)]

    class FailCloseSession(Session):
        def close(self):
            super().close()
            if self.info.get("committed"):
                raise RuntimeError("private-close-marker")

    def mark_committed(db):
        db.info["committed"] = True

    event.listen(FailCloseSession, "after_commit", mark_committed)
    caplog.set_level(logging.INFO, logger="commerce.expiry")
    cutoff = datetime.now(UTC)
    for index, order in enumerate(orders):
        set_deadline(engine, order["id"], cutoff - timedelta(seconds=2 - index))
    cursor = expiry.ExpiryCursor()
    with pytest.raises(RuntimeError, match="Reservation sweep failed for 2 orders") as caught:
        expiry.expire_due_orders(
            sessionmaker(engine, class_=FailCloseSession),
            now=cutoff,
            cursor=cursor,
        )
    assert cursor.after == (cutoff - timedelta(seconds=1), orders[-1]["id"])
    events = [
        json.loads(record.message) for record in caplog.records if record.name == "commerce.expiry"
    ]
    assert {"event": "reservations_expired", "orders": 2} in events
    assert "private-close-marker" not in "".join(traceback.format_exception(caught.value))
    assert "private-close-marker" not in caplog.text
    with Session(engine) as db:
        assert all(db.get(Order, order["id"]).status == "cancelled" for order in orders)
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_released")
            )
            == 2
        )
    assert (
        expiry.expire_due_orders(sessionmaker(engine), now=datetime.now(UTC) + timedelta(days=1))
        == 0
    )


def test_worker_survives_logging_failure(monkeypatch, broken_expiry_logging):
    calls = []
    monkeypatch.setattr(settings, "reservation_sweep_seconds", 0.01)

    async def exercise():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()

        def sweep(*, cursor):
            calls.append(cursor)
            if len(calls) == 1:
                raise RuntimeError("private-worker-marker")
            loop.call_soon_threadsafe(stop.set)

        monkeypatch.setattr(expiry, "expire_due_orders", sweep)
        await asyncio.wait_for(expiry.expiry_loop(stop), timeout=5)

    asyncio.run(exercise())
    assert len(calls) == 2


def test_lifespan_releases_without_requests_and_stops(commerce, variant, monkeypatch):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    completed = Event()
    original = expiry.expire_due_orders
    calls = []

    def sweep(*, cursor):
        calls.append(original(sessionmaker(engine), cursor=cursor))
        completed.set()

    monkeypatch.setattr(expiry, "expire_due_orders", sweep)
    monkeypatch.setattr(settings, "reservation_sweeper_enabled", True)

    async def exercise():
        async with lifespan(app):
            assert await asyncio.to_thread(completed.wait, 5)
        assert calls == [1]

    asyncio.run(exercise())
    assert_released_once(engine, variant, order["id"])


def test_worker_recovers_after_transient_error(monkeypatch, caplog):
    calls = []
    monkeypatch.setattr(settings, "reservation_sweep_seconds", 0.01)

    async def exercise():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()

        def sweep(*, cursor):
            calls.append(cursor)
            if len(calls) == 1:
                raise RuntimeError("temporary failure")
            loop.call_soon_threadsafe(stop.set)

        monkeypatch.setattr(expiry, "expire_due_orders", sweep)
        await asyncio.wait_for(expiry.expiry_loop(stop), timeout=5)

    asyncio.run(exercise())
    assert len(calls) == 2
    assert "reservation_sweep_failed" in caplog.text


def test_deadline_normalization_and_invalid_config():
    aware = datetime(2026, 9, 21, tzinfo=UTC)
    assert as_utc(aware.replace(tzinfo=None)) == aware
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(reservation_ttl_seconds=0)
