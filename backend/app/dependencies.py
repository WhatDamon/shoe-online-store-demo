from collections.abc import Iterator
from hmac import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.infrastructure.database import SessionLocal


def database() -> Iterator[Session]:
    with SessionLocal() as session, session.begin():
        yield session


def internal_proxy(
    x_internal_proxy_secret: Annotated[str | None, Header()] = None,
) -> None:
    """Require the server-only proxy credential when one is configured."""
    configured = settings.commerce_proxy_secret.strip()
    if not configured:
        if settings.app_env == "production":
            raise HTTPException(status_code=503, detail="Service temporarily unavailable")
        return
    if x_internal_proxy_secret is None or not compare_digest(
        x_internal_proxy_secret.encode("utf-8"), configured.encode("utf-8")
    ):
        raise HTTPException(status_code=403, detail="Request not allowed")


def anonymous_session(x_session_id: Annotated[UUID, Header()]) -> str:
    # A random UUID is a bearer credential, supplied by the Next HttpOnly cookie proxy.
    return str(x_session_id)
