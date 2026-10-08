import pytest
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session

from app.api.v1 import routes
from app.application import commerce as service
from app.domain.models import (
    AuditLog,
    Inventory,
    Order,
    OrderItem,
    Payment,
    PaymentEvent,
    Product,
    Reservation,
    Variant,
)


def test_openapi_describes_every_success_response(commerce):
    client, _ = commerce
    paths = client.get("/openapi.json").json()["paths"]
    expected = [
        ("/health", "get", "HealthResponse"),
        ("/api/v1/catalog/products/{handle}", "get", "ProductResponse"),
        ("/api/v1/cart", "get", "CartResponse"),
        ("/api/v1/cart/items", "post", "CartResponse"),
        ("/api/v1/cart/items/{item_id}", "patch", "CartResponse"),
        ("/api/v1/cart/items/{item_id}", "delete", "CartResponse"),
        ("/api/v1/checkout/preview", "post", "CartResponse"),
        ("/api/v1/checkout/create-order", "post", "OrderResponse"),
        ("/api/v1/orders/{order_id}", "get", "OrderResponse"),
        ("/api/v1/orders/{order_id}/cancel", "post", "OrderResponse"),
        ("/api/v1/payments/session", "post", "PaymentResponse"),
    ]
    for path, method, model in expected:
        schema = paths[path][method]["responses"]["200"]["content"]["application/json"]["schema"]
        assert schema["$ref"] == f"#/components/schemas/{model}"
    catalog = paths["/api/v1/catalog/products"]["get"]["responses"]["200"]
    schema = catalog["content"]["application/json"]["schema"]
    assert schema["type"] == "array"
    assert schema["items"]["$ref"] == "#/components/schemas/ProductResponse"


def test_catalog_list_uses_batch_queries(commerce):
    client, engine = commerce
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get("/api/v1/catalog/products")
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert len(statements) == 3
    assert sum("FROM products" in statement for statement in statements) == 1
    assert sum("product_variants" in statement for statement in statements) == 1
    assert sum("product_media" in statement for statement in statements) == 1


def test_catalog_empty_list_reads_only_products(commerce):
    client, engine = commerce
    with Session(engine) as db, db.begin():
        db.execute(update(Product).values(is_active=False))
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get("/api/v1/catalog/products")
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert response.json() == []
    assert len(statements) == 1
    assert "FROM products" in statements[0]


def test_catalog_batch_matches_details_and_preserves_active_filter_and_sort(commerce):
    client, engine = commerce
    with Session(engine) as db, db.begin():
        db.execute(update(Product).where(Product.handle == "dc-1002").values(is_active=False))
        product_id = db.scalar(select(Product.id).where(Product.handle == "dc-1001"))
        inactive = db.scalar(select(Variant).where(Variant.product_id == product_id))
        inactive.is_active = False
        inactive_variant_id = inactive.id

    response = client.get("/api/v1/catalog/products")
    assert response.status_code == 200
    products = response.json()
    assert len(products) == 28
    assert "dc-1002" not in [product["handle"] for product in products]
    assert [product["handle"] for product in products] == sorted(
        product["handle"] for product in products
    )
    for product in products:
        detail = client.get(f"/api/v1/catalog/products/{product['handle']}")
        assert detail.status_code == 200
        assert detail.json() == product
        variants = product["variants"]
        assert [(variant["color"], variant["size"]) for variant in variants] == sorted(
            (variant["color"], variant["size"]) for variant in variants
        )
        assert inactive_variant_id not in [variant["id"] for variant in variants]
    assert client.get("/api/v1/catalog/products/dc-1002").status_code == 404


@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("price", 59.0),
        ("price", "-1.00"),
        ("price", "1.234"),
        ("price", "NaN"),
        ("available", -1),
        ("available", "10"),
        ("currency", "usd"),
    ],
)
def test_catalog_rejects_invalid_variant_output(commerce, monkeypatch, field, invalid):
    client, _ = commerce
    original = routes.product_view

    def invalid_product(db, product):
        result = original(db, product)
        result["variants"][0][field] = invalid
        return result

    monkeypatch.setattr(routes, "product_view", invalid_product)
    response = client.get("/api/v1/catalog/products/dc-1001")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"


def test_internal_catalog_fields_are_not_exposed(commerce, monkeypatch):
    client, _ = commerce
    original = routes.product_views

    def internal_products(db, products):
        results = original(db, products)
        for result in results:
            result["internal_token"] = "not-public"
            for variant in result["variants"]:
                variant["supplier_cost"] = "not-public"
        return results

    monkeypatch.setattr(routes, "product_views", internal_products)
    for path in ("/api/v1/catalog/products", "/api/v1/catalog/products/dc-1001"):
        response = client.get(path)
        assert response.status_code == 200
        assert "internal_token" not in response.text
        assert "supplier_cost" not in response.text
        assert "not-public" not in response.text


@pytest.mark.parametrize(
    ("field", "invalid"),
    [("total", 118.0), ("status", "paid"), ("payment_enabled", True), ("quantity", "2")],
)
def test_invalid_order_response_rolls_back_checkout(commerce, variant, monkeypatch, field, invalid):
    client, engine = commerce
    added = client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 2})
    assert added.status_code == 200
    with Session(engine) as db:
        before = {
            model: db.scalar(select(func.count()).select_from(model))
            for model in (Order, OrderItem, Reservation, AuditLog)
        }
    original = service.order_view

    def invalid_order(db, order):
        result = original(db, order)
        if field == "quantity":
            result["items"][0][field] = invalid
        else:
            result[field] = invalid
        return result

    monkeypatch.setattr(service, "order_view", invalid_order)
    response = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": "response-contract"}
    )
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    with Session(engine) as db:
        for model, count in before.items():
            assert db.scalar(select(func.count()).select_from(model)) == count
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 2


@pytest.mark.parametrize(
    ("field", "invalid"),
    [("charged", True), ("payment_enabled", True), ("provider", "live"), ("order_status", "paid")],
)
def test_invalid_payment_response_rolls_back_writes(commerce, variant, monkeypatch, field, invalid):
    client, engine = commerce
    client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 1})
    order = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": "response-payment"}
    ).json()
    original = service.MockPaymentProvider.create_session

    def invalid_payment(self, db, order):
        result = original(self, db, order)
        result[field] = invalid
        return result

    monkeypatch.setattr(service.MockPaymentProvider, "create_session", invalid_payment)
    response = client.post("/api/v1/payments/session", json={"order_id": order["id"]})
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    with Session(engine) as db:
        for model in (Payment, PaymentEvent):
            assert db.scalar(select(func.count()).select_from(model)) == 0
        assert db.get(Order, order["id"]).status == "pending_payment"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (9, 1)
