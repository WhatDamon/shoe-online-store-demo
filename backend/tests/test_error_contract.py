import json
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.application import commerce as service
from app.config import settings
from app.domain.models import AuditLog, Inventory, Order, OrderItem, Reservation


def test_application_layer_does_not_import_fastapi():
    root = Path(__file__).parents[1] / "app" / "application"
    assert all("fastapi" not in path.read_text(encoding="utf-8") for path in root.glob("*.py"))


def test_validation_does_not_echo_private_input(commerce, caplog):
    client, _ = commerce
    secret = "private-token-do-not-echo"
    response = client.post(
        "/api/v1/cart/items",
        headers={"X-Session-ID": secret, "X-Request-ID": secret},
        json={"variant_id": secret, "quantity": secret},
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "detail": "Request validation failed"}
    assert response.headers["cache-control"] == "no-store"
    assert UUID(response.headers["x-request-id"]).version == 4
    assert secret not in response.text + caplog.text


def test_request_id_correlates_safe_business_error_and_log(commerce, caplog):
    client, _ = commerce
    trace_id = str(uuid4())
    with caplog.at_level("INFO", logger="commerce"):
        response = client.get(
            "/api/v1/catalog/products/private-handle?token=private-query",
            headers={"X-Request-ID": trace_id},
        )
    assert response.status_code == 404
    assert response.headers["x-request-id"] == trace_id
    records = [json.loads(r.message) for r in caplog.records if r.name == "commerce"]
    assert len(records) == 1
    assert records[0]["request_id"] == trace_id
    assert records[0]["route"] == "/api/v1/catalog/products/{handle}"
    assert records[0]["code"] == "product_not_found"
    assert "private-" not in json.dumps(records)


def test_unknown_route_and_method_use_stable_contract(commerce):
    client, _ = commerce
    missing = client.get("/unrecognized-private-path")
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"
    method = client.post("/health")
    assert method.status_code == 405
    assert method.json()["code"] == "method_not_allowed"
    assert "GET" in method.headers["allow"]
    assert method.headers["cache-control"] == "no-store"


def test_production_api_requires_internal_proxy_secret(commerce, monkeypatch):
    client, _ = commerce
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "commerce_proxy_secret", "abcdefghijklmnopqrstuvwxyz123456")
    missing = client.get("/api/v1/catalog/products")
    wrong = client.get(
        "/api/v1/catalog/products", headers={"X-Internal-Proxy-Secret": "wrong-secret"}
    )
    correct = client.get(
        "/api/v1/catalog/products",
        headers={"X-Internal-Proxy-Secret": "abcdefghijklmnopqrstuvwxyz123456"},
    )
    assert missing.status_code == 403
    assert wrong.status_code == 403
    assert correct.status_code == 200


def test_unexpected_failure_is_safe_and_rolls_back_all_writes(
    commerce, variant, monkeypatch, caplog
):
    client, engine = commerce
    client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 2})
    with Session(engine) as db:
        before = {
            model: db.scalar(select(func.count()).select_from(model))
            for model in (Order, OrderItem, Reservation, AuditLog)
        }
    original = service.audit
    secret = "postgresql://private-user:private-password@internal-db/orders"

    def broken_audit(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_created":
            raise RuntimeError(secret)

    monkeypatch.setattr(service, "audit", broken_audit)
    with caplog.at_level("INFO", logger="commerce"):
        response = client.post(
            "/api/v1/checkout/create-order", headers={"Idempotency-Key": "failure-rollback"}
        )
    assert response.status_code == 500
    assert response.json() == {"code": "internal_error", "detail": "Request could not be completed"}
    assert response.headers["cache-control"] == "no-store"
    assert UUID(response.headers["x-request-id"]).version == 4
    assert secret not in response.text + caplog.text
    assert any('"code": "internal_error"' in r.message for r in caplog.records)
    with Session(engine) as db:
        for model, count in before.items():
            assert db.scalar(select(func.count()).select_from(model)) == count
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 2


def test_openapi_errors_match_runtime_contract(commerce):
    client, _ = commerce
    schema = client.get("/openapi.json").json()
    responses = schema["paths"]["/api/v1/cart/items"]["post"]["responses"]
    for status in ("404", "409", "422", "500"):
        assert responses[status]["content"]["application/json"]["schema"]["$ref"] == (
            "#/components/schemas/ErrorResponse"
        )
