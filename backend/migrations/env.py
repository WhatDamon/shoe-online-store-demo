from alembic import context
from sqlalchemy.engine import Connection

from app.config import settings
from app.domain.models import Base
from app.infrastructure.database import make_engine

target_metadata = Base.metadata


def migrate(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(
        url=settings.database_url, target_metadata=target_metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
elif (connection := context.config.attributes.get("connection")) is not None:
    # Tests supply an isolated connection instead of changing global database settings.
    migrate(connection)
else:
    engine = make_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
