import pytest
from sqlalchemy.engine import make_url

from app.config import Settings
from app.infrastructure.database import make_engine, validate_database_url


@pytest.mark.parametrize(
    "value",
    [
        "sqlite:///./commerce.db",
        "postgresql+psycopg://user:password@db.example/evoloop",
        "postgresql+psycopg://user:password@db.example/evoloop?sslmode=require",
        "postgresql+psycopg://user:password@db.example/evoloop?sslmode=verify-ca",
        "postgresql+psycopg:///evoloop?sslmode=verify-full",
        "postgresql+psycopg://user:password@/evoloop?hostaddr=127.0.0.1&sslmode=verify-full",
        "postgresql+psycopg://user:password@db.example/evoloop?sslmode=verify-full&sslmode=verify-full",
    ],
)
def test_production_database_requires_postgres_verify_full(value):
    with pytest.raises(ValueError, match="Production"):
        validate_database_url(value, app_env="production")


def test_production_database_accepts_explicit_verify_full_without_connecting():
    value = (
        "postgresql://user:password@db.example:5432/evoloop"
        "?sslmode=verify-full&sslrootcert=/run/secrets/postgres-ca.pem"
    )
    normalized = validate_database_url(value, app_env="production")
    parsed = make_url(normalized)
    assert parsed.drivername == "postgresql+psycopg"
    assert parsed.query["sslmode"] == "verify-full"

    engine = make_engine(value, app_env="production")
    try:
        assert engine.url.query["sslmode"] == "verify-full"
    finally:
        engine.dispose()


def test_development_sqlite_remains_the_default_boundary():
    normalized = validate_database_url("sqlite://", app_env="development")
    assert normalized == "sqlite://"


def test_unknown_environment_fails_closed():
    with pytest.raises(ValueError, match="APP_ENV"):
        validate_database_url("sqlite://", app_env="prod")


def test_node_production_environment_defaults_to_production(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("NODE_ENV", " Production ")
    assert (
        Settings(
            commerce_proxy_secret="abcdefghijklmnopqrstuvwxyz123456",
            _env_file=None,
        ).app_env
        == "production"
    )
