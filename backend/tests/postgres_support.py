"""Opt-in integration databases: only a fresh owned schema is ever removed."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.schema import CreateSchema, DropSchema


def validated_test_url(value: str) -> URL:
    try:
        url = make_url(value)
    except ArgumentError:
        raise ValueError(
            "Integration URL must identify a dedicated PostgreSQL _test database"
        ) from None
    if (
        url.get_backend_name() != "postgresql"
        or not url.database
        or not url.database.endswith("_test")
        or "options" in url.query
    ):
        raise ValueError("Integration URL must identify a dedicated PostgreSQL _test database")
    return url.set(drivername="postgresql+psycopg")


def migration_config(connection) -> Config:
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.attributes["connection"] = connection
    return config


@contextmanager
def postgres_database(value: str) -> Iterator[Engine]:
    url = validated_test_url(value)
    schema = f"commerce_test_{uuid4().hex}"
    admin = create_engine(url, connect_args={"connect_timeout": 10})
    isolated = create_engine(
        url,
        connect_args={
            "connect_timeout": 10,
            "options": f"-csearch_path={schema} -cstatement_timeout=15000 -clock_timeout=10000",
        },
    )
    created = False
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        created = True
        with isolated.connect() as connection:
            command.upgrade(migration_config(connection), "head")
        yield isolated
    finally:
        isolated.dispose()
        try:
            if created:
                with admin.begin() as connection:
                    connection.execute(DropSchema(schema, cascade=True))
        finally:
            admin.dispose()
