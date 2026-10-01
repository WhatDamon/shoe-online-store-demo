import os

import pytest
from alembic import command
from sqlalchemy import inspect, text

from app.config import settings
from app.infrastructure.database import make_engine
from tests.postgres_support import migration_config, postgres_database, validated_test_url


@pytest.mark.parametrize(
    "value",
    [
        "not-a-url",
        "sqlite:///commerce_test",
        "postgresql://localhost/production",
        "postgresql://localhost/commerce_test?options=-csearch_path=public",
    ],
)
def test_integration_url_rejects_unsafe_targets(value):
    with pytest.raises(ValueError, match="dedicated PostgreSQL _test database"):
        validated_test_url(value)


def test_integration_url_keeps_connection_security_options():
    url = validated_test_url("postgresql://localhost/commerce_test?sslmode=verify-full")
    assert url.drivername == "postgresql+psycopg"
    assert url.query["sslmode"] == "verify-full"


def test_migrations_use_supplied_connection_without_opening_configured_database(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "unsupported://must-not-connect")
    engine = make_engine("sqlite://")
    try:
        with engine.connect() as connection:
            config = migration_config(connection)
            command.upgrade(config, "head")
            command.check(config)
            assert "orders" in inspect(connection).get_table_names()
    finally:
        engine.dispose()


@pytest.mark.skipif(
    not os.getenv("COMMERCE_TEST_POSTGRES_URL"),
    reason="Dedicated PostgreSQL test URL not configured",
)
def test_postgres_migration_upgrade_downgrade_and_schema_parity():
    with postgres_database(os.environ["COMMERCE_TEST_POSTGRES_URL"]) as engine:
        with engine.connect() as connection:
            schema = connection.scalar(text("select current_schema()"))
            assert schema.startswith("commerce_test_")
            connection.rollback()
            config = migration_config(connection)
            command.check(config)
            command.downgrade(config, "base")
            assert set(inspect(connection).get_table_names()) <= {"alembic_version"}
            connection.rollback()
            command.upgrade(config, "head")
            command.check(config)
