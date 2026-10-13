import os
import sqlite3
from contextlib import closing
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.application.payments import (
    CheckoutLineItem,
    CheckoutSession,
    StripeGatewayError,
)
from app.config import settings
from app.dependencies import database
from app.infrastructure.database import make_engine
from app.main import app
from app.seed import seed
from tests.postgres_support import postgres_database


@pytest.fixture(scope="session")
def template(tmp_path_factory):
    path = tmp_path_factory.mktemp("template") / "commerce.db"
    original = settings.commerce_database_url
    settings.commerce_database_url = f"sqlite:///{path.as_posix()}"
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
    engine = make_engine(settings.commerce_database_url)
    with Session(engine) as db, db.begin():
        seed(db)
    engine.dispose()
    settings.commerce_database_url = original
    return path


@pytest.fixture(scope="session")
def snapshot_database():
    def snapshot(source: Path, target: Path) -> None:
        source_uri = f"{source.resolve().as_uri()}?mode=ro"
        with (
            closing(sqlite3.connect(source_uri, uri=True)) as reader,
            closing(sqlite3.connect(target)) as writer,
        ):
            reader.backup(writer)

    return snapshot


@pytest.fixture(
    params=["sqlite", "postgres"] if os.getenv("COMMERCE_TEST_POSTGRES_URL") else ["sqlite"]
)
def commerce_engine(request, template, tmp_path, snapshot_database):
    if request.param == "postgres":
        with postgres_database(os.environ["COMMERCE_TEST_POSTGRES_URL"]) as engine:
            with Session(engine) as db, db.begin():
                seed(db)
            yield engine
        return
    path = tmp_path / "commerce.db"
    snapshot_database(template, path)
    engine = make_engine(f"sqlite:///{path.as_posix()}")
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def commerce(commerce_engine, monkeypatch):
    # API tests use isolated DBs; worker lifecycle has dedicated tests with its own DB.
    monkeypatch.setattr(settings, "reservation_sweeper_enabled", False)
    engine = commerce_engine

    def session():
        with Session(engine) as db, db.begin():
            yield db

    app.dependency_overrides[database] = session
    try:
        with TestClient(app) as client:
            client.headers["X-Session-ID"] = str(uuid4())
            yield client, engine
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def variant(commerce):
    client, _ = commerce
    return client.get("/api/v1/catalog/products/dc-1001").json()["variants"][0]


class FakeStripeGateway:
    """Recording StripeGateway double: fixed results, no network access.

    Tests drive Stripe behaviour through this fake, so the whole payment flow is provable
    offline. ``missing`` makes a retrieved session look gone.
    """

    def __init__(
        self,
        *,
        session_id: str = "cs_test_fake",
        url: str | None = "https://checkout.stripe.com/c/pay/cs_test_fake",
        status: str = "open",
    ) -> None:
        self.session_id = session_id
        self.url = url
        self.status = status
        self.missing = False
        self.created: list[dict] = []
        self.retrieved: list[str] = []
        self.refunds: list[dict] = []

    def create_checkout_session(
        self,
        *,
        order_id: str,
        currency: str,
        line_items: list[CheckoutLineItem],
        expires_at: datetime,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> CheckoutSession:
        self.created.append(
            dict(
                order_id=order_id,
                currency=currency,
                line_items=[asdict(item) for item in line_items],
                expires_at=expires_at,
                success_url=success_url,
                cancel_url=cancel_url,
                idempotency_key=idempotency_key,
            )
        )
        return CheckoutSession(id=self.session_id, url=self.url, status=self.status)

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSession | None:
        self.retrieved.append(session_id)
        if self.missing:
            return None
        return CheckoutSession(id=session_id, url=self.url, status=self.status)

    def refund(self, *, payment_intent: str, idempotency_key: str) -> str:
        self.refunds.append(dict(payment_intent=payment_intent, idempotency_key=idempotency_key))
        return "re_test_fake"


class FailingStripeGateway:
    """Every outbound call fails; records what was attempted."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def create_checkout_session(self, **kwargs: object) -> CheckoutSession:
        self.calls.append("create_checkout_session")
        raise StripeGatewayError("simulated Stripe failure")

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSession | None:
        self.calls.append("retrieve_checkout_session")
        raise StripeGatewayError("simulated Stripe failure")

    def refund(self, *, payment_intent: str, idempotency_key: str) -> str:
        self.calls.append("refund")
        raise StripeGatewayError("simulated Stripe failure")


@pytest.fixture
def fake_gateway() -> FakeStripeGateway:
    return FakeStripeGateway()


@pytest.fixture
def failing_gateway() -> FailingStripeGateway:
    return FailingStripeGateway()
