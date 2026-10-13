"""The internal proxy credential: what it gates, and what a rejected call cannot do.

Every ``/api/v1`` route hangs off one router whose only dependency is ``internal_proxy``
(``app/dependencies.py``), so the payment endpoints inherit the same gate as the catalog
routes. These tests pin the two of them that money depends on: a forged "paid" event must
never be ingestable anonymously, an anonymous caller must never open a refund, and a
rejected request must leave neither a row nor an outbound refund behind.

The webhook's own rejection and storage behaviour is pinned in ``tests/test_webhooks.py``
(the wrong secret, the single acknowledged row, and the 503 both without a configured
secret and -- stricter than the rest of the router -- outside production as well). What this
file adds is the statement that one does not make: the payment endpoints are gated *like
every other* ``/api/v1`` route, and the refund endpoint, which had no credential test at
all, cannot reach Stripe.
"""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, settings
from app.domain.models import Order, Payment, WebhookEvent

PROXY_SECRET = "abcdefghijklmnopqrstuvwxyz123456"
FORBIDDEN = {"code": "forbidden", "detail": "Request not allowed"}
FORGED_EVENT = {"id": "evt_forged", "type": "checkout.session.completed"}


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


def forged_payment_event(client, headers=None):
    return client.post("/api/v1/webhooks/stripe", json=FORGED_EVENT, headers=headers)


def refund_request(client, order_id, headers=None):
    return client.post(f"/api/v1/orders/{order_id}/refund", headers=headers)


def gated_calls(client, order_id):
    """The money-moving endpoints, keyed by route, each callable with an optional credential."""
    return {
        "POST /api/v1/webhooks/stripe": lambda headers: forged_payment_event(client, headers),
        "POST /api/v1/orders/{id}/refund": lambda headers: refund_request(
            client, order_id, headers
        ),
    }


@pytest.mark.parametrize(
    "route", ["POST /api/v1/webhooks/stripe", "POST /api/v1/orders/{id}/refund"]
)
def test_payment_endpoints_share_the_router_credential(commerce, monkeypatch, paid_order, route):
    client, _ = commerce
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "commerce_proxy_secret", PROXY_SECRET)
    call = gated_calls(client, paid_order["id"])[route]

    missing = call(None)
    wrong = call({"X-Internal-Proxy-Secret": "wrong-secret"})
    accepted = call({"X-Internal-Proxy-Secret": PROXY_SECRET})

    # The 403 is the credential and not a broken route: the same call carrying the secret
    # passes the gate and reaches the business layer (the event is acknowledged as ignored,
    # the refund leaves through the recording fake gateway).
    assert (missing.status_code, wrong.status_code) == (403, 403)
    assert missing.json() == wrong.json() == FORBIDDEN
    assert accepted.status_code == 200


def test_a_rejected_call_leaves_no_data_behind(commerce, monkeypatch, paid_order, stripe_checkout):
    client, engine = commerce
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "commerce_proxy_secret", PROXY_SECRET)

    # No credential at all: what any stranger reaching the Python origin directly can send.
    assert forged_payment_event(client).status_code == 403
    assert refund_request(client, paid_order["id"]).status_code == 403

    with Session(engine) as db:
        stored_events = db.scalar(select(func.count()).select_from(WebhookEvent))
        order = db.get(Order, paid_order["id"])
        payment = db.scalar(select(Payment).where(Payment.order_id == paid_order["id"]))

    # A forged event that never entered the ledger, and money no anonymous request touched:
    # had either call passed the gate, the refund attempt would be visible as an outbound
    # refund and the order would no longer be a paid one.
    assert stored_events == 0
    assert stripe_checkout.refunds == []
    assert (order.status, order.refunded_at) == ("paid", None)
    assert (payment.status, payment.refunded_at) == ("succeeded", None)
