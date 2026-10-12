import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnvironment = Literal["development", "test", "production"]

ROOT_ENV = Path(__file__).parents[2] / ".env"
BACKEND_ENV = Path(__file__).parents[1] / ".env"


def default_app_environment() -> AppEnvironment:
    """Mirror common deployment environments when APP_ENV is omitted."""
    return (
        "production" if os.getenv("NODE_ENV", "").strip().lower() == "production" else "development"
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT_ENV, BACKEND_ENV), extra="ignore")
    app_env: AppEnvironment = Field(default_factory=default_app_environment)
    database_url: str = "sqlite:///./commerce.db"
    commerce_proxy_secret: str = ""
    reservation_ttl_seconds: int = Field(default=1800, ge=1, le=604800)
    reservation_sweep_seconds: int = Field(default=30, ge=1, le=3600)
    reservation_sweep_batch_size: int = Field(default=100, ge=1, le=1000)
    reservation_sweeper_enabled: bool = True
    stripe_enabled: bool = False
    stripe_secret_key: str = ""
    stripe_api_timeout_seconds: int = Field(default=10, ge=1, le=60)
    public_site_url: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("PUBLIC_SITE_URL", "NEXT_PUBLIC_SITE_URL"),
    )

    @property
    def stripe_ready(self) -> bool:
        """Only runtime source of truth for whether Stripe checkout is usable."""
        return self.stripe_enabled and bool(self.stripe_secret_key.strip())

    @model_validator(mode="after")
    def validate_production_proxy_secret(self) -> "Settings":
        node_env = os.getenv("NODE_ENV", "").strip().lower()
        if node_env == "production" and self.app_env != "production":
            raise ValueError("APP_ENV must be production when NODE_ENV=production")
        if self.app_env == "production" and len(self.commerce_proxy_secret.encode("utf-8")) < 32:
            raise ValueError("COMMERCE_PROXY_SECRET must contain at least 32 bytes in production")
        return self

    @model_validator(mode="after")
    def validate_stripe_configuration(self) -> "Settings":
        """Half-configured Stripe must fail at start-up instead of at checkout."""
        if not self.stripe_enabled:
            return self
        if not self.stripe_secret_key.strip():
            raise ValueError("STRIPE_SECRET_KEY is required when STRIPE_ENABLED=true")
        site_url = urlsplit(self.public_site_url)
        if site_url.scheme not in ("http", "https") or not site_url.netloc:
            raise ValueError(
                "PUBLIC_SITE_URL must be an absolute http(s) URL when STRIPE_ENABLED=true"
            )
        if self.app_env == "production" and site_url.scheme != "https":
            raise ValueError("PUBLIC_SITE_URL must use https in production")
        return self


settings = Settings()
