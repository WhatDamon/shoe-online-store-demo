"""Retain catalog identity and historical references when sales are disabled."""

import sqlalchemy as sa
from alembic import op

revision = "c73a28f06b19"
down_revision = "a682dde201b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("products", "product_variants"):
        op.add_column(
            table, sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true())
        )


def downgrade() -> None:
    # Dropping this gate would silently re-enable retired items in older code.
    # Restore intentionally and re-check, or keep the additive schema on rollback.
    connection = op.get_bind()
    for name in ("products", "product_variants"):
        table = sa.table(name, sa.column("is_active", sa.Boolean()))
        if connection.scalar(sa.select(sa.func.count()).where(table.c.is_active.is_(False))):
            raise RuntimeError("Restore inactive catalog entries before availability downgrade")
    for name in ("product_variants", "products"):
        op.drop_column(name, "is_active")
