"""Add independent payment, fulfillment, and reservation states."""

import sqlalchemy as sa
from alembic import op

from app.domain.states import ORDER_STATUSES, PAYMENT_STATUSES, RESERVATION_STATUSES, sql_in

revision = "1fbc05b17480"
down_revision = "c73a28f06b19"
branch_labels = None
depends_on = None

_OLD_CHECK_NAMING = {"ck": "ck_%(table_name)s_%(column_0_name)s"}


def _drop_legacy_status_check(table: str, legacy_values: tuple[str, ...]) -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        return
    expected = {value.casefold() for value in legacy_values}
    for constraint in sa.inspect(connection).get_check_constraints(table):
        expression = constraint.get("sqltext", "").casefold()
        if "status" in expression and all(value in expression for value in expected):
            op.drop_constraint(constraint["name"], table, type_="check")
            return
    raise RuntimeError(f"Could not find legacy status check constraint on {table}")


def upgrade() -> None:
    _drop_legacy_status_check("orders", ("pending_payment", "cancelled"))
    _drop_legacy_status_check("payments", ("disabled",))
    _drop_legacy_status_check("inventory_reservations", ("active", "released"))

    with op.batch_alter_table("orders") as batch_op:
        batch_op.create_check_constraint("ck_orders_order_status", sql_in("status", ORDER_STATUSES))
        batch_op.add_column(sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("payments") as batch_op:
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
        (
            "orders",
            sql_in(
                "status",
                tuple(s for s in ORDER_STATUSES if s not in ("pending_payment", "cancelled")),
            ),
        ),
        (
            "payments",
            sql_in("status", tuple(s for s in PAYMENT_STATUSES if s != "disabled")),
        ),
        (
            "inventory_reservations",
            sql_in(
                "status",
                tuple(s for s in RESERVATION_STATUSES if s != "active" and s != "released"),
            ),
        ),
    )
    for table, condition in checks:
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
