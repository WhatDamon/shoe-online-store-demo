from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import Session, sessionmaker

from app.config import AppEnvironment, settings


def validate_database_url(url: str, *, app_env: AppEnvironment | str | None = None) -> str:
    """Validate the database boundary before SQLAlchemy creates a connection pool."""
    environment = settings.app_env if app_env is None else app_env
    if environment not in ("development", "test", "production"):
        raise ValueError("APP_ENV must be development, test, or production")

    normalized = url
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+psycopg://", 1)

    try:
        parsed = make_url(normalized)
    except ArgumentError:
        raise ValueError("Invalid commerce database URL") from None

    if environment == "production":
        if parsed.get_backend_name() != "postgresql":
            raise ValueError("Production commerce database must use PostgreSQL")
        if not parsed.host:
            raise ValueError("Production PostgreSQL URL must include an explicit host")
        if parsed.query.get("sslmode") != "verify-full":
            raise ValueError("Production PostgreSQL requires sslmode=verify-full")

    return normalized


def make_engine(url: str, *, app_env: AppEnvironment | str | None = None) -> Engine:
    url = validate_database_url(url, app_env=app_env)
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": 15}
        if url.startswith("sqlite")
        else {},
    )
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def configure(connection, _record) -> None:  # type: ignore[no-untyped-def]
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")

    return engine


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(engine, class_=Session, expire_on_commit=False)
