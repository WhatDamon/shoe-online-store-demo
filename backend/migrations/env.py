from alembic import context
from sqlalchemy.engine import Connection

from app.config import settings
from app.domain.models import Base
from app.infrastructure.database import make_engine

target_metadata = Base.metadata


def _set_sqlite_foreign_keys(connection: Connection, *, enabled: bool) -> None:
    """Change SQLite's foreign-key setting on the driver connection.

    The statement goes to the driver connection rather than through SQLAlchemy's
    ``Connection``: executing anything there opens a transaction, and alembic reads that
    state while configuring -- a connection that already has one is treated as owned by its
    caller, so it commits nothing and the whole upgrade is rolled back on close.

    SQLite ignores the pragma inside a transaction, which is also how a caller that supplies
    its own open transaction keeps the setting it chose: the statement becomes a no-op and
    that caller owns the outcome.
    """
    connection.connection.dbapi_connection.execute(
        f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}"
    )


def migrate(connection: Connection) -> None:
    # SQLite cannot rebuild a table that other tables reference while foreign keys are
    # enforced: ``DROP TABLE`` performs an implicit DELETE, so the batch recreate of
    # ``orders`` fails as soon as one child row (an order item, a payment, a reservation)
    # exists. ``SQLiteImpl`` never manages this pragma, and this connection is not ours to
    # leave changed, so it is switched off for the migration and back on afterwards.
    sqlite = connection.dialect.name == "sqlite"
    if sqlite:
        _set_sqlite_foreign_keys(connection, enabled=False)
    try:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    finally:
        if sqlite:
            _set_sqlite_foreign_keys(connection, enabled=True)


if context.is_offline_mode():
    context.configure(
        url=settings.commerce_database_url, target_metadata=target_metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
elif (connection := context.config.attributes.get("connection")) is not None:
    # Tests supply an isolated connection instead of changing global database settings.
    migrate(connection)
else:
    engine = make_engine(settings.commerce_database_url)
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
