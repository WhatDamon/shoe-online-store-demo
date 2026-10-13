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
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.application import payments
from app.application.payments import (
    CheckoutLineItem,
    CheckoutSession,
    RefundResult,
    StripeGatewayError,
    confirm_payment,
)
from app.config import settings
from app.dependencies import database
from app.domain.models import Order
from app.infrastructure.database import make_engine
from app.main import app
from app.seed import seed
from tests.postgres_support import postgres_database

# The credential every test that walks the fail-closed webhook presents. It is longer than
# the 32 bytes production requires and it is not a deployment secret.
PROXY_SECRET = "abcdefghijklmnopqrstuvwxyz123456"


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


@pytest.fixture(autouse=True)
def stripe_disabled(monkeypatch):
    """Pin the only payment switch off unless a test turns Stripe on itself.

    ``Settings`` reads the repository's root and backend ``.env`` files by design, so a
    developer who enables Stripe there would otherwise push every disabled-path test onto
    the live Stripe branch and make the suite red under a legal configuration. Tests that
    need Stripe on patch ``stripe_enabled`` themselves: their patches are applied after
    this fixture and therefore win.
    """
    monkeypatch.setattr(settings, "stripe_enabled", False)
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    assert settings.stripe_ready is False


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
def proxy_credential(commerce, monkeypatch):
    """Configure the internal proxy credential and present it on every call of the test.

    Only the routes that fail closed without it need this: a test that configures the
    credential has to send it on all of its own calls too, because the gate applies to the
    whole ``/api/v1`` router and not only to the webhook. The rest of the suite keeps the
    development passthrough and exercises it without a credential.
    """
    client, _ = commerce
    monkeypatch.setattr(settings, "commerce_proxy_secret", PROXY_SECRET)
    headers = {"X-Internal-Proxy-Secret": PROXY_SECRET}
    client.headers.update(headers)
    return headers


@pytest.fixture
def variant(commerce):
    client, _ = commerce
    return client.get("/api/v1/catalog/products/dc-1001").json()["variants"][0]


def place_order(client, variant, key=None, quantity=1):
    """Add one line to the cart and create the order a test works on."""
    client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": quantity})
    response = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": key or str(uuid4())}
    )
    assert response.status_code == 200
    return response.json()


def session_post(client, order_id, **kwargs):
    return client.post("/api/v1/payments/session", json={"order_id": order_id}, **kwargs)


def update_order(engine, order_id, **values):
    """Force a column value the HTTP flow cannot reach on its own."""
    with Session(engine) as db, db.begin():
        db.execute(update(Order).where(Order.id == order_id).values(**values))


class FakeStripeGateway:
    """Recording StripeGateway double: fixed results, no network access.

    Tests drive Stripe behaviour through this fake, so the whole payment flow is provable
    offline. ``missing`` makes a retrieved session look gone, and ``refund_status`` is the
    lifecycle state the next refund reports: Stripe settles an asynchronous refund later, so
    a test can move it from ``pending`` to ``succeeded`` between attempts.
    """

    def __init__(
        self,
        *,
        session_id: str = "cs_test_fake",
        url: str | None = "https://checkout.stripe.com/c/pay/cs_test_fake",
        status: str = "open",
        refund_status: str = "succeeded",
    ) -> None:
        self.session_id = session_id
        self.url = url
        self.status = status
        self.refund_status = refund_status
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

    def refund(self, *, payment_intent: str, idempotency_key: str) -> RefundResult:
        self.refunds.append(dict(payment_intent=payment_intent, idempotency_key=idempotency_key))
        return RefundResult(id="re_test_fake", status=self.refund_status)


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

    def refund(self, *, payment_intent: str, idempotency_key: str) -> RefundResult:
        self.calls.append("refund")
        raise StripeGatewayError("simulated Stripe failure")


@pytest.fixture
def fake_gateway() -> FakeStripeGateway:
    return FakeStripeGateway()


@pytest.fixture
def failing_gateway() -> FailingStripeGateway:
    return FailingStripeGateway()


@pytest.fixture
def payable_order(commerce, variant, monkeypatch):
    """An order whose reservation outlives Stripe's 30-minute minimum window."""
    client, _ = commerce
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 3600)
    return place_order(client, variant)


@pytest.fixture
def stripe_checkout(monkeypatch, fake_gateway):
    """Enable Stripe and route the outbound seam to the recording fake gateway."""
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_payment_boundary")
    monkeypatch.setattr(payments, "default_gateway", lambda: fake_gateway)
    return fake_gateway


@pytest.fixture
def paid_order(commerce, payable_order, stripe_checkout):
    """An order paid through the real path: hosted session first, then its confirmation."""
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    with Session(engine) as db, db.begin():
        outcome = confirm_payment(
            db,
            order_id=payable_order["id"],
            provider_reference=stripe_checkout.session_id,
            payment_intent="pi_test_paid",
        )
        assert outcome.status == "paid"
    return payable_order


@pytest.fixture
def refund_pending_order(commerce, payable_order, stripe_checkout):
    """Money captured after the reservation was released: the refund signal."""
    client, engine = commerce
    assert session_post(client, payable_order["id"]).json()["code"] == "payment_ready"
    assert client.post(f"/api/v1/orders/{payable_order['id']}/cancel").status_code == 200
    with Session(engine) as db, db.begin():
        outcome = confirm_payment(
            db,
            order_id=payable_order["id"],
            provider_reference=stripe_checkout.session_id,
            payment_intent="pi_test_late",
        )
        assert outcome.status == "refund_pending"
    return payable_order
