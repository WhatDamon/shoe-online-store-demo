"""Add independent payment, fulfillment, and reservation states."""

import re

import sqlalchemy as sa
from alembic import op

from app.domain.states import ORDER_STATUSES, PAYMENT_STATUSES, RESERVATION_STATUSES, sql_in

revision = "1fbc05b17480"
down_revision = "c73a28f06b19"
branch_labels = None
depends_on = None

_OLD_CHECK_NAMING = {"ck": "ck_%(table_name)s_%(column_0_name)s"}
# The states each table's pre-existing status check allows, spelled once: upgrade drops
# exactly this check and downgrade refuses to run while states outside it are stored.
_LEGACY_STATUSES = {
    "orders": ("pending_payment", "cancelled"),
    "payments": ("disabled",),
    "inventory_reservations": ("active", "released"),
}
_CHECK_LITERAL = re.compile(r"'([^']*)'")


def _drop_legacy_status_check(batch_op, table: str, dialect: str) -> None:
    """Drop the table's pre-existing status check inside its batch alter.

    SQLite rebuilds the table and omits only the reflected checks that have no name, so a
    check named by an earlier downgrade would be copied onto the new table next to the
    widened one and silently keep rejecting the new states.  Dropping it explicitly keeps
    SQLite and PostgreSQL on the same path; PostgreSQL additionally has to find it.
    """
    expected = {value.casefold() for value in _LEGACY_STATUSES[table]}
    for constraint in sa.inspect(op.get_bind()).get_check_constraints(table):
        expression = (constraint.get("sqltext") or "").casefold()
        name = constraint.get("name")
        if not name or "status" not in expression:
            continue
        if {match.casefold() for match in _CHECK_LITERAL.findall(expression)} == expected:
            batch_op.drop_constraint(name, type_="check")
            return
    if dialect == "sqlite":
        # A database that never ran the downgrade carries this check unnamed; the batch
        # recreate drops it on its own.
        return
    raise RuntimeError(f"Could not find legacy status check constraint on {table}")


def upgrade() -> None:
    dialect = op.get_bind().dialect.name

    with op.batch_alter_table("orders") as batch_op:
        _drop_legacy_status_check(batch_op, "orders", dialect)
        batch_op.create_check_constraint("ck_orders_order_status", sql_in("status", ORDER_STATUSES))
        batch_op.add_column(sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("payments") as batch_op:
        _drop_legacy_status_check(batch_op, "payments", dialect)
        batch_op.create_check_constraint(
            "ck_payments_payment_status", sql_in("status", PAYMENT_STATUSES)
        )
        batch_op.add_column(sa.Column("provider_reference", sa.String(200), nullable=True))
        batch_op.add_column(sa.Column("payment_intent", sa.String(200), nullable=True))
        batch_op.add_column(sa.Column("amount", sa.Numeric(12, 2), nullable=True))
        batch_op.add_column(sa.Column("currency", sa.String(3), nullable=True))
        batch_op.add_column(sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("succeeded_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index(
        "ix_payments_provider_reference",
        "payments",
        ["provider_reference"],
        unique=True,
    )

    with op.batch_alter_table("inventory_reservations") as batch_op:
        _drop_legacy_status_check(batch_op, "inventory_reservations", dialect)
        batch_op.create_check_constraint(
            "ck_inventory_reservations_reservation_status",
            sql_in("status", RESERVATION_STATUSES),
        )

    with op.batch_alter_table("webhook_events") as batch_op:
        batch_op.add_column(
            sa.Column("status", sa.String(20), nullable=False, server_default="received")
        )
        batch_op.add_column(sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("received_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()
    checks = (
        ("orders", ORDER_STATUSES),
        ("payments", PAYMENT_STATUSES),
        ("inventory_reservations", RESERVATION_STATUSES),
    )
    for table, statuses in checks:
        added = tuple(status for status in statuses if status not in _LEGACY_STATUSES[table])
        condition = sql_in("status", added)
        if connection.scalar(sa.text(f"SELECT 1 FROM {table} WHERE {condition} LIMIT 1")):
            raise RuntimeError(f"Cannot downgrade payment states while {table} has new state rows")

    with op.batch_alter_table("webhook_events") as batch_op:
        batch_op.drop_column("processed_at")
        batch_op.drop_column("received_at")
        batch_op.drop_column("attempts")
        batch_op.drop_column("status")

    with op.batch_alter_table(
        "inventory_reservations", naming_convention=_OLD_CHECK_NAMING
    ) as batch_op:
        batch_op.drop_constraint("ck_inventory_reservations_reservation_status", type_="check")
        batch_op.create_check_constraint(
            "ck_inventory_reservations_status", "status IN ('active', 'released')"
        )

    op.drop_index("ix_payments_provider_reference", table_name="payments")
    with op.batch_alter_table("payments", naming_convention=_OLD_CHECK_NAMING) as batch_op:
        batch_op.drop_constraint("ck_payments_payment_status", type_="check")
        batch_op.create_check_constraint("ck_payments_status", "status = 'disabled'")
        batch_op.drop_column("refunded_at")
        batch_op.drop_column("succeeded_at")
        batch_op.drop_column("created_at")
        batch_op.drop_column("currency")
        batch_op.drop_column("amount")
        batch_op.drop_column("payment_intent")
        batch_op.drop_column("provider_reference")

    with op.batch_alter_table("orders", naming_convention=_OLD_CHECK_NAMING) as batch_op:
        batch_op.drop_constraint("ck_orders_order_status", type_="check")
        batch_op.create_check_constraint(
            "ck_orders_status", "status IN ('pending_payment', 'cancelled')"
        )
        batch_op.drop_column("refunded_at")
        batch_op.drop_column("paid_at")
