import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.postgres_support import migration_config


def run_migration(engine, operation, revision):
    with engine.connect() as connection:
        operation(migration_config(connection), revision)


def test_availability_upgrade_preserves_existing_catalog_and_defaults_active(commerce_engine):
    engine = commerce_engine
    with engine.connect() as connection:
        products = connection.execute(
            text("SELECT id, handle, title FROM products ORDER BY id")
        ).all()
        variants = connection.execute(
            text("SELECT id, product_id, sku, price FROM product_variants ORDER BY id")
        ).all()
        stock = connection.execute(text("SELECT * FROM inventory ORDER BY variant_id")).all()
    run_migration(engine, command.downgrade, "a682dde201b4")
    with engine.connect() as connection:
        for table in ("products", "product_variants"):
            assert "is_active" not in {c["name"] for c in inspect(connection).get_columns(table)}
    run_migration(engine, command.upgrade, "head")
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT id, handle, title FROM products ORDER BY id")).all()
            == products
        )
        assert (
            connection.execute(
                text("SELECT id, product_id, sku, price FROM product_variants ORDER BY id")
            ).all()
            == variants
        )
        assert (
            connection.execute(text("SELECT * FROM inventory ORDER BY variant_id")).all() == stock
        )
        for table in ("products", "product_variants"):
            assert connection.scalar(
                text(f"SELECT COUNT(*) FROM {table} WHERE is_active = true")
            ) == (len(products) if table == "products" else len(variants))
            column = next(
                c for c in inspect(connection).get_columns(table) if c["name"] == "is_active"
            )
            assert column["nullable"] is False


@pytest.mark.parametrize("inactive_table", ["products", "product_variants"])
def test_downgrade_cannot_silently_revive_inactive_catalog(commerce_engine, inactive_table):
    engine = commerce_engine
    with engine.begin() as connection:
        key = connection.scalar(text(f"SELECT id FROM {inactive_table} ORDER BY id LIMIT 1"))
        connection.execute(
            text(f"UPDATE {inactive_table} SET is_active = false WHERE id = :id"), {"id": key}
        )
    with pytest.raises(RuntimeError, match="Restore inactive catalog"):
        run_migration(engine, command.downgrade, "a682dde201b4")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "c73a28f06b19"
        assert (
            connection.scalar(
                text(f"SELECT COUNT(*) FROM {inactive_table} WHERE is_active = false")
            )
            == 1
        )
        for table in ("products", "product_variants"):
            assert "is_active" in {c["name"] for c in inspect(connection).get_columns(table)}
    with engine.begin() as connection:
        connection.execute(
            text(f"UPDATE {inactive_table} SET is_active = true WHERE id = :id"), {"id": key}
        )
    run_migration(engine, command.downgrade, "a682dde201b4")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "a682dde201b4"
