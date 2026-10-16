import json
import logging
from collections.abc import Iterator
from hmac import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.infrastructure.database import SessionLocal

logger = logging.getLogger("commerce.proxy")

PROXY_CREDENTIAL_HINT = (
    "COMMERCE_PROXY_SECRET is not configured, so the payment webhook cannot accept "
    "deliveries. Set the shared server-to-server credential the Next proxy signs with."
)


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


def webhook_proxy() -> None:
    """Refuse the webhook when no credential is configured, in every environment.

    ``internal_proxy`` lets an unconfigured credential through outside production, which is
    why the rest of ``/api/v1`` keeps working on a laptop: those routes are only reachable
    through the Next server, and a session cookie still owns every cart. This route is
    different -- nothing but the credential stands between the public internet and a forged
    ``checkout.session.completed`` that would mark an order paid -- so a missing credential
    must mean "deny". The status is the same 503 the production path of ``internal_proxy``
    returns; the actionable half goes to the log, because ``app.main`` normalizes the body
    of every 503 into one shape.
    """
    if settings.commerce_proxy_secret.strip():
        return
    logger.error(json.dumps(dict(event="webhook_credential_missing", detail=PROXY_CREDENTIAL_HINT)))
    raise HTTPException(status_code=503, detail=PROXY_CREDENTIAL_HINT)


def anonymous_session(x_session_id: Annotated[UUID, Header()]) -> str:
    # A random UUID is a bearer credential, supplied by the Next HttpOnly cookie proxy.
    return str(x_session_id)
