import os
from pathlib import Path
from typing import Literal

from pydantic import Field
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
    reservation_ttl_seconds: int = Field(default=1800, ge=1, le=604800)
    reservation_sweep_seconds: int = Field(default=30, ge=1, le=3600)
    reservation_sweep_batch_size: int = Field(default=100, ge=1, le=1000)
    reservation_sweeper_enabled: bool = True


settings = Settings()
