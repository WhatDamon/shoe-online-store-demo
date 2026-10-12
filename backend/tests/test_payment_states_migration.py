from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.postgres_support import migration_config


def _run_migration(engine, operation, revision):
    with engine.connect() as connection:
        operation(migration_config(connection), revision)


def _insert_order(connection, status: str) -> str:
    cart_id = str(uuid4())
    order_id = str(uuid4())
    connection.execute(text("INSERT INTO carts (id, revision) VALUES (:id, 0)"), {"id": cart_id})
    connection.execute(
        text(
            "INSERT INTO orders "
            "(id, cart_id, idempotency_key, status, total, currency, created_at) "
            "VALUES (:id, :cart_id, :key, :status, 0, 'USD', CURRENT_TIMESTAMP)"
        ),
        {"id": order_id, "cart_id": cart_id, "key": str(uuid4()), "status": status},
    )
    return order_id


def test_orders_accepts_paid_and_refunded(commerce_engine):
    with commerce_engine.begin() as connection:
        assert _insert_order(connection, "paid")
        assert _insert_order(connection, "refunded")


def test_payments_keeps_legacy_disabled_and_accepts_stripe_states(commerce_engine):
    statuses = ("disabled", "requires_payment", "succeeded", "refund_pending", "refunded")
    with commerce_engine.begin() as connection:
        for status in statuses:
            order_id = _insert_order(connection, "pending_payment")
            connection.execute(
                text(
                    "INSERT INTO payments (id, order_id, provider, status) "
                    "VALUES (:id, :order_id, 'mock', :status)"
                ),
                {"id": str(uuid4()), "order_id": order_id, "status": status},
            )


def test_reservations_accept_consumed(commerce_engine):
    with commerce_engine.begin() as connection:
        order_id = _insert_order(connection, "paid")
        variant_id = connection.scalar(text("SELECT id FROM product_variants LIMIT 1"))
        connection.execute(
            text(
                "INSERT INTO inventory_reservations "
                "(id, order_id, variant_id, quantity, status) "
                "VALUES (:id, :order_id, :variant_id, 1, 'consumed')"
            ),
            {"id": str(uuid4()), "order_id": order_id, "variant_id": variant_id},
        )


def test_rejects_unknown_states(commerce_engine):
    with commerce_engine.begin() as connection:
        order_id = _insert_order(connection, "pending_payment")
        variant_id = connection.scalar(text("SELECT id FROM product_variants LIMIT 1"))

    with pytest.raises(IntegrityError):
        with commerce_engine.begin() as connection:
            connection.execute(
                text("UPDATE orders SET status = 'weird' WHERE id = :id"), {"id": order_id}
            )

    with pytest.raises(IntegrityError):
        with commerce_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO payments (id, order_id, provider, status) "
                    "VALUES (:id, :order_id, 'mock', 'weird')"
                ),
                {"id": str(uuid4()), "order_id": order_id},
            )

    with pytest.raises(IntegrityError):
        with commerce_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO inventory_reservations "
                    "(id, order_id, variant_id, quantity, status) "
                    "VALUES (:id, :order_id, :variant_id, 1, 'weird')"
                ),
                {"id": str(uuid4()), "order_id": order_id, "variant_id": variant_id},
            )


def test_downgrade_refuses_new_state_rows_without_deleting_them(commerce_engine):
    with commerce_engine.begin() as connection:
        order_id = _insert_order(connection, "paid")
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        with pytest.raises(RuntimeError, match="new state rows"):
            command.downgrade(config, "-1")
        assert (
            connection.scalar(text("SELECT status FROM orders WHERE id = :id"), {"id": order_id})
            == "paid"
        )


def test_upgrade_after_downgrade_drops_the_named_legacy_status_checks(commerce_engine):
    # downgrade recreates the old status checks *with names*; the next upgrade runs batch
    # recreation on SQLite, which copies reflected named constraints, so those checks would
    # survive next to the new ones and keep rejecting the new states.
    _run_migration(commerce_engine, command.downgrade, "-1")
    _run_migration(commerce_engine, command.upgrade, "head")

    with commerce_engine.begin() as connection:
        assert _insert_order(connection, "paid")
        order_id = _insert_order(connection, "pending_payment")
        connection.execute(
            text(
                "INSERT INTO payments (id, order_id, provider, status) "
                "VALUES (:id, :order_id, 'mock', 'succeeded')"
            ),
            {"id": str(uuid4()), "order_id": order_id},
        )
        variant_id = connection.scalar(text("SELECT id FROM product_variants LIMIT 1"))
        connection.execute(
            text(
                "INSERT INTO inventory_reservations "
                "(id, order_id, variant_id, quantity, status) "
                "VALUES (:id, :order_id, :variant_id, 1, 'consumed')"
            ),
            {"id": str(uuid4()), "order_id": order_id, "variant_id": variant_id},
        )


def test_new_payment_columns_exist_and_are_nullable(commerce_engine):
    columns = {
        column["name"]: column for column in inspect(commerce_engine).get_columns("payments")
    }
    expected = {
        "provider_reference",
        "payment_intent",
        "amount",
        "currency",
        "created_at",
        "succeeded_at",
        "refunded_at",
    }
    expected |= {"order_id", "provider", "status", "id"}
    assert expected <= columns.keys()
    nullable = {
        "provider_reference",
        "payment_intent",
        "amount",
        "currency",
        "created_at",
        "succeeded_at",
        "refunded_at",
    }
    assert all(columns[name]["nullable"] for name in nullable)

    indexes = inspect(commerce_engine).get_indexes("payments")
    assert any(
        index["unique"] and index["column_names"] == ["provider_reference"] for index in indexes
    )

    for table, expected_columns in {
        "orders": {"paid_at", "refunded_at"},
        "webhook_events": {"status", "attempts", "received_at", "processed_at"},
    }.items():
        table_columns = {
            column["name"]: column for column in inspect(commerce_engine).get_columns(table)
        }
        assert expected_columns <= table_columns.keys()
        for name in expected_columns:
            if name in {"status", "attempts"}:
                assert not table_columns[name]["nullable"]
                assert table_columns[name]["default"] is not None
            else:
                assert table_columns[name]["nullable"]
