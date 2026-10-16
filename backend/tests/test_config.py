"""Configuration contract: root `.env` as the single source, plus Stripe settings.

Tests never touch the repository's real `.env` files: they build their own env files
under `tmp_path` and pass them through `_env_file`, then pin the class-level file
chain (`ROOT_ENV`, `BACKEND_ENV`) so swapping the two paths fails the suite.
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app import config
from app.config import Settings

STRIPE_KEY = "sk_test_placeholder"
PROXY_SECRET = "abcdefghijklmnopqrstuvwxyz123456"


def test_reads_root_env_file(monkeypatch, tmp_path):
    monkeypatch.delenv("COMMERCE_DATABASE_URL", raising=False)
    monkeypatch.delenv("RESERVATION_TTL_SECONDS", raising=False)
    root_env = tmp_path / ".env"
    root_env.write_text(
        "COMMERCE_DATABASE_URL=sqlite:///./from-root.db\nRESERVATION_TTL_SECONDS=3600\n",
        encoding="utf-8",
    )

    loaded = Settings(_env_file=(root_env,))

    assert loaded.commerce_database_url == "sqlite:///./from-root.db"
    assert loaded.reservation_ttl_seconds == 3600
    assert config.ROOT_ENV == Path(config.__file__).parents[2] / ".env"
    assert Settings.model_config["env_file"] == (config.ROOT_ENV, config.BACKEND_ENV)


def test_backend_env_overrides_root_env(monkeypatch, tmp_path):
    monkeypatch.delenv("COMMERCE_PROXY_SECRET", raising=False)
    monkeypatch.delenv("RESERVATION_TTL_SECONDS", raising=False)
    root_env = tmp_path / "root.env"
    root_env.write_text(
        "RESERVATION_TTL_SECONDS=3600\nCOMMERCE_PROXY_SECRET=root-secret\n",
        encoding="utf-8",
    )
    backend_env = tmp_path / "backend.env"
    backend_env.write_text("RESERVATION_TTL_SECONDS=5400\n", encoding="utf-8")

    loaded = Settings(_env_file=(root_env, backend_env))

    assert loaded.reservation_ttl_seconds == 5400
    assert loaded.commerce_proxy_secret == "root-secret"
    assert config.BACKEND_ENV == Path(config.__file__).parents[1] / ".env"
    assert Settings.model_config["env_file"] == (config.ROOT_ENV, config.BACKEND_ENV)


def test_next_database_url_never_reaches_python(monkeypatch, tmp_path):
    """The shared root `.env` also carries Next's DATABASE_URL: Python must ignore it.

    DATABASE_URL is the Next/Drizzle display+AI database (`./data/local.db`) while Python
    owns the commerce database; honouring that key would break the documented
    "copy one root .env" setup by pointing the backend at the wrong file.
    """
    monkeypatch.delenv("COMMERCE_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://display.example/next")
    assert Settings(_env_file=None).commerce_database_url == "sqlite:///./commerce.db"

    next_only = tmp_path / "next-only.env"
    next_only.write_text("DATABASE_URL=./data/local.db\n", encoding="utf-8")

    assert Settings(_env_file=(next_only,)).commerce_database_url == "sqlite:///./commerce.db"

    both_keys = tmp_path / "both.env"
    both_keys.write_text(
        "DATABASE_URL=./data/local.db\nCOMMERCE_DATABASE_URL=sqlite:///./from-root.db\n",
        encoding="utf-8",
    )

    assert Settings(_env_file=(both_keys,)).commerce_database_url == "sqlite:///./from-root.db"


@pytest.mark.parametrize("name", ["PUBLIC_SITE_URL", "NEXT_PUBLIC_SITE_URL"])
def test_site_url_accepts_both_names(monkeypatch, name):
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SITE_URL", raising=False)
    monkeypatch.setenv(name, "https://evoloop.site")

    assert Settings(_env_file=None).public_site_url == "https://evoloop.site"

    # PUBLIC_SITE_URL is the dedicated name; it wins when both are set.
    monkeypatch.setenv("PUBLIC_SITE_URL", "https://checkout.example")
    assert Settings(_env_file=None).public_site_url == "https://checkout.example"


def test_enabled_without_secret_key_fails_at_startup(monkeypatch):
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SITE_URL", raising=False)

    with pytest.raises(ValidationError, match="STRIPE_SECRET_KEY"):
        Settings(_env_file=None, stripe_enabled=True, public_site_url="https://evoloop.site")

    monkeypatch.setenv("STRIPE_SECRET_KEY", "   ")
    with pytest.raises(ValidationError, match="STRIPE_SECRET_KEY"):
        Settings(_env_file=None, stripe_enabled=True, public_site_url="https://evoloop.site")


def test_enabled_with_relative_site_url_fails_at_startup(monkeypatch):
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("STRIPE_ENABLED", raising=False)
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SITE_URL", raising=False)
    enabled = {"stripe_enabled": True, "stripe_secret_key": STRIPE_KEY}

    with pytest.raises(ValidationError, match="PUBLIC_SITE_URL"):
        Settings(_env_file=None, public_site_url="/orders", **enabled)

    with pytest.raises(ValidationError, match="PUBLIC_SITE_URL"):
        Settings(_env_file=None, public_site_url="localhost:3000", **enabled)

    # Production must be https; plain http stays valid for local development.
    with pytest.raises(ValidationError, match="https"):
        Settings(
            _env_file=None,
            public_site_url="http://evoloop.site",
            app_env="production",
            commerce_proxy_secret=PROXY_SECRET,
            **enabled,
        )

    local = Settings(_env_file=None, public_site_url="http://localhost:3000", **enabled)
    assert local.stripe_ready is True


def test_disabled_ignores_missing_stripe_configuration(monkeypatch, tmp_path):
    monkeypatch.delenv("NODE_ENV", raising=False)
    for name in ("STRIPE_ENABLED", "STRIPE_SECRET_KEY", "PUBLIC_SITE_URL", "NEXT_PUBLIC_SITE_URL"):
        monkeypatch.delenv(name, raising=False)

    # No env files at all: the default path must stay constructible and unchanged.
    disabled = Settings(_env_file=(tmp_path / "root.env", tmp_path / "backend.env"))

    assert disabled.stripe_enabled is False
    assert disabled.stripe_secret_key == ""
    assert disabled.stripe_api_timeout_seconds == 10
    assert disabled.public_site_url == "http://localhost:3000"
    assert disabled.stripe_ready is False

    explicit = Settings(_env_file=None, stripe_enabled=False, public_site_url="/orders")
    assert explicit.stripe_ready is False


def test_stripe_ready_requires_all_pieces(monkeypatch):
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("STRIPE_ENABLED", raising=False)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SITE_URL", raising=False)

    assert Settings(_env_file=None).stripe_ready is False

    enabled = Settings(
        _env_file=None,
        stripe_enabled=True,
        stripe_secret_key=STRIPE_KEY,
        public_site_url="https://evoloop.site",
    )
    assert enabled.stripe_ready is True

    # Enabling from the environment alone is half-configured: start-up must fail
    # rather than expose settings whose stripe_ready is quietly False.
    monkeypatch.setenv("STRIPE_ENABLED", "true")
    with pytest.raises(ValidationError, match="STRIPE_SECRET_KEY"):
        Settings(_env_file=None, public_site_url="https://evoloop.site")
