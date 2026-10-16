from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import CheckConstraint, inspect, text
from sqlalchemy.exc import IntegrityError

from app.domain.models import Base
from app.infrastructure.database import make_engine
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


# The revision this migration already applied when a database is first populated with real
# orders: the state before the three rebuilt tables gain their widened checks.
BEFORE_PAYMENT_STATES = "c73a28f06b19"
REBUILT_TABLES = ("orders", "payments", "inventory_reservations")


def _normalized(expression: str) -> str:
    """One spelling per check: databases re-print their own text, so compare semantics."""
    sqltext = " ".join(str(expression).casefold().split())
    while sqltext.startswith("(") and sqltext.endswith(")"):
        sqltext = sqltext[1:-1].strip()
    return sqltext


def _declared_checks(table: str) -> set[tuple[str, str]]:
    return {
        (constraint.name, _normalized(str(constraint.sqltext)))
        for constraint in Base.metadata.tables[table].constraints
        if isinstance(constraint, CheckConstraint)
    }


def _stored_checks(engine, table: str) -> set[tuple[str, str]]:
    return {
        (constraint["name"], _normalized(constraint["sqltext"]))
        for constraint in inspect(engine).get_check_constraints(table)
    }


def _insert_order_with_children(connection) -> dict[str, str]:
    """A real order with every child row that points at it, all foreign keys satisfied."""
    ids = {
        "cart": str(uuid4()),
        "order": str(uuid4()),
        "variant": str(uuid4()),
        "item": str(uuid4()),
        "payment": str(uuid4()),
        "reservation": str(uuid4()),
    }
    connection.execute(
        text("INSERT INTO carts (id, revision) VALUES (:cart, 0)"), {"cart": ids["cart"]}
    )
    connection.execute(
        text("INSERT INTO products (id, handle, title, description) VALUES ('p1', 'p1', 't', 'd')")
    )
    connection.execute(
        text(
            "INSERT INTO product_variants "
            "(id, product_id, sku, color, color_hex, size, price, currency) "
            "VALUES (:variant, 'p1', 'sku-1', 'black', '#000000', 42, 59.00, 'USD')"
        ),
        {"variant": ids["variant"]},
    )
    connection.execute(
        text("INSERT INTO inventory (variant_id, available, reserved) VALUES (:variant, 9, 1)"),
        {"variant": ids["variant"]},
    )
    connection.execute(
        text(
            "INSERT INTO orders "
            "(id, cart_id, idempotency_key, status, total, currency, created_at) "
            "VALUES (:order, :cart, 'key-1', 'pending_payment', 59.00, 'USD', CURRENT_TIMESTAMP)"
        ),
        {"order": ids["order"], "cart": ids["cart"]},
    )
    connection.execute(
        text(
            "INSERT INTO order_items "
            "(id, order_id, variant_id, title, sku, color, size, unit_price, quantity) "
            "VALUES (:item, :order, :variant, 't', 'sku-1', 'black', 42, 59.00, 1)"
        ),
        {"item": ids["item"], "order": ids["order"], "variant": ids["variant"]},
    )
    connection.execute(
        text(
            "INSERT INTO payments (id, order_id, provider, status) "
            "VALUES (:payment, :order, 'mock', 'disabled')"
        ),
        {"payment": ids["payment"], "order": ids["order"]},
    )
    connection.execute(
        text(
            "INSERT INTO inventory_reservations (id, order_id, variant_id, quantity, status) "
            "VALUES (:reservation, :order, :variant, 1, 'active')"
        ),
        {"reservation": ids["reservation"], "order": ids["order"], "variant": ids["variant"]},
    )
    return ids


@pytest.fixture(scope="module")
def populated_database_at_head(tmp_path_factory):
    """A SQLite database holding real parent and child rows, upgraded to head.

    The engine is the application's own, so ``PRAGMA foreign_keys=ON`` is in force exactly
    as it is on a developer's commerce.db: the upgrade has to cope with enforced foreign
    keys rather than be handed a database with them switched off.
    """
    path = tmp_path_factory.mktemp("populated") / "commerce.db"
    engine = make_engine(f"sqlite:///{path.as_posix()}")
    with engine.connect() as connection:
        # 1. the revision before this branch's migration, on an empty schema.
        command.upgrade(migration_config(connection), BEFORE_PAYMENT_STATES)
        # 2. real rows, in foreign-key dependency order.
        ids = _insert_order_with_children(connection)
        connection.commit()
        # 3. the upgrade under test, with foreign keys enforced.
        command.upgrade(migration_config(connection), "head")
    try:
        yield engine, ids
    finally:
        engine.dispose()


def test_upgrade_of_a_populated_database_keeps_every_child_row(populated_database_at_head):
    engine, ids = populated_database_at_head
    with engine.connect() as connection:
        for table, identifier in (
            ("orders", ids["order"]),
            ("order_items", ids["item"]),
            ("payments", ids["payment"]),
            ("inventory_reservations", ids["reservation"]),
        ):
            assert (
                connection.scalar(
                    text(f"SELECT count(*) FROM {table} WHERE id = :id"), {"id": identifier}
                )
                == 1
            )
        # The pragma is a connection setting, so it has to be back where it started, and
        # nothing may be left pointing at a row that moved.
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []

    # Enforced, not merely enabled: a child row for an unknown order cannot be written.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO order_items "
                "(id, order_id, variant_id, title, sku, color, size, unit_price, quantity) "
                "VALUES (:id, 'not-an-order', :variant, 't', 'sku-1', 'black', 42, 59.00, 1)"
            ),
            {"id": str(uuid4()), "variant": ids["variant"]},
        )


@pytest.mark.parametrize("table", REBUILT_TABLES)
def test_rebuilt_tables_keep_every_check_constraint_the_models_declare(
    populated_database_at_head, table
):
    """SQLite's batch recreate omits unnamed checks, so they must be named to survive."""
    engine, _ = populated_database_at_head

    assert _stored_checks(engine, table) == _declared_checks(table)
