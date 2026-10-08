import os
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnvironment = Literal["development", "test", "production"]


def default_app_environment() -> AppEnvironment:
    """Mirror common deployment environments when APP_ENV is omitted."""
    return (
        "production" if os.getenv("NODE_ENV", "").strip().lower() == "production" else "development"
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).parents[1] / ".env", extra="ignore")
    app_env: AppEnvironment = Field(default_factory=default_app_environment)
    database_url: str = "sqlite:///./commerce.db"
    commerce_proxy_secret: str = ""
    reservation_ttl_seconds: int = Field(default=1800, ge=1, le=604800)
    reservation_sweep_seconds: int = Field(default=30, ge=1, le=3600)
    reservation_sweep_batch_size: int = Field(default=100, ge=1, le=1000)
    reservation_sweeper_enabled: bool = True

    @model_validator(mode="after")
    def validate_production_proxy_secret(self) -> "Settings":
        node_env = os.getenv("NODE_ENV", "").strip().lower()
        if node_env == "production" and self.app_env != "production":
            raise ValueError("APP_ENV must be production when NODE_ENV=production")
        if self.app_env == "production" and len(self.commerce_proxy_secret.encode("utf-8")) < 32:
            raise ValueError("COMMERCE_PROXY_SECRET must contain at least 32 bytes in production")
        return self


settings = Settings()
