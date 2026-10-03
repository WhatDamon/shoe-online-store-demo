import pytest

from app.config import Settings


def test_production_settings_require_proxy_secret():
    with pytest.raises(ValueError, match="COMMERCE_PROXY_SECRET"):
        Settings(app_env="production", commerce_proxy_secret="short", _env_file=None)


def test_production_settings_accept_random_proxy_secret():
    settings = Settings(
        app_env="production",
        commerce_proxy_secret="abcdefghijklmnopqrstuvwxyz123456",
        _env_file=None,
    )
    assert settings.app_env == "production"
