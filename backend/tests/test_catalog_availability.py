import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event, local
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app import sync_catalog
from app.application import catalog_sync, commerce
from app.application.errors import VariantUnavailable
from app.application.expiry import expire_due_orders
from app.config import settings
from app.domain.catalog_identity import stable_variant_id
from app.domain.models import AuditLog, CartItem, Inventory, Order, Product, Reservation, Variant
from app.seed import seed

CATALOG_PATH = Path(__file__).parents[1] / "data/catalog.json"


def source_without(product_id):
    return [p for p in sync_catalog.load_snapshot(CATALOG_PATH) if p.id != product_id]


def database_state(engine):
    with Session(engine) as db:
        return {
            "products": list(db.execute(select(Product.__table__).order_by(Product.id))),
            "variants": list(db.execute(select(Variant.__table__).order_by(Variant.id))),
            "stock": list(db.execute(select(Inventory.__table__).order_by(Inventory.variant_id))),
            "audit": list(db.execute(select(AuditLog.__table__).order_by(AuditLog.id))),
        }


def apply_source(engine, source, *, restore_present=False):
    with Session(engine) as db:
        plan = catalog_sync.plan_availability(db, source, restore_present=restore_present)
    with Session(engine) as db, db.begin():
        return catalog_sync.apply_availability(
            db, source, plan.plan_version, restore_present=restore_present
        )


def test_deleted_product_and_options_preview_preserves_all_business_data(commerce_engine):
    source = source_without("evo-02")
    product = next(p for p in source if p.id == "evo-01")
    reduced = replace(product, colors=product.colors[1:], sizes=product.sizes[1:])
    source = [reduced if p.id == product.id else p for p in source]
    before = database_state(commerce_engine)
    with Session(commerce_engine) as db, db.begin():
        plan = catalog_sync.plan_availability(db, source)
    assert database_state(commerce_engine) == before
    deleted = next(p for p in sync_catalog.load_snapshot(CATALOG_PATH) if p.id == "evo-02")
    assert {(c.entity, c.id) for c in plan.changes} == {
        ("product", deleted.id),
        *(("variant", v) for v in deleted.variant_ids()),
        *(("variant", v) for v in product.variant_ids() - reduced.variant_ids()),
    }
    assert all(c.before is True and c.after is False for c in plan.changes)
    applied = apply_source(commerce_engine, source)
    assert applied == plan
    after = database_state(commerce_engine)
    assert after["stock"] == before["stock"]
    with Session(commerce_engine) as db:
        assert db.get(Product, "evo-02").is_active is False
        assert db.get(Product, "evo-01").is_active is True
        remaining = set(
            db.scalars(
                select(Variant.id).where(Variant.product_id == product.id, Variant.is_active)
            )
        )
        assert remaining == reduced.variant_ids()
        audits = db.scalars(
            select(AuditLog).where(AuditLog.action == "catalog_availability_changed")
        ).all()
        assert len(audits) == len(plan.changes)
        assert all(
            a.details["source_version"] == plan.source_version
            and a.details["plan_version"] == plan.plan_version
            and a.details["before"] is True
            and a.details["after"] is False
            for a in audits
        )
    assert apply_source(commerce_engine, source).changes == ()
    assert database_state(commerce_engine) == after


@pytest.mark.parametrize("changed", ["source", "database", "restore_mode"])
def test_apply_requires_current_reviewed_plan(commerce_engine, changed):
    source = source_without("evo-01")
    with Session(commerce_engine) as db:
        plan = catalog_sync.plan_availability(db, source)
    if changed == "source":
        source = source_without("evo-02")
    elif changed == "database":
        with Session(commerce_engine) as db, db.begin():
            db.get(Product, "evo-02").is_active = False
    before = database_state(commerce_engine)
    with pytest.raises(catalog_sync.CatalogSyncError, match="Plan changed"):
        with Session(commerce_engine) as db, db.begin():
            catalog_sync.apply_availability(
                db, source, plan.plan_version, restore_present=changed == "restore_mode"
            )
    assert database_state(commerce_engine) == before


def test_audit_failure_rolls_back_all_availability_changes(commerce_engine, monkeypatch):
    source = source_without("evo-01")
    before = database_state(commerce_engine)
    original = catalog_sync.audit
    calls = []

    def fail_after_change(db, entity, action, **details):
        original(db, entity, action, **details)
        db.flush()
        calls.append(entity)
        if len(calls) == 2:
            raise RuntimeError("injected audit failure")

    monkeypatch.setattr(catalog_sync, "audit", fail_after_change)
    with pytest.raises(RuntimeError, match="injected audit failure"):
        apply_source(commerce_engine, source)
    assert len(calls) == 2
    assert database_state(commerce_engine) == before


def test_seed_and_default_sync_do_not_revive_retired_catalog(commerce_engine):
    full = sync_catalog.load_snapshot(CATALOG_PATH)
    apply_source(commerce_engine, source_without("evo-01"))
    before = database_state(commerce_engine)
    with Session(commerce_engine) as db, db.begin():
        seed(db)
    assert apply_source(commerce_engine, full).changes == ()
    assert database_state(commerce_engine) == before
    restored = apply_source(commerce_engine, full, restore_present=True)
    assert restored.changes
    assert all(c.before is False and c.after is True for c in restored.changes)
    with Session(commerce_engine) as db:
        assert db.get(Product, "evo-01").is_active is True
        assert all(db.scalars(select(Variant.is_active).where(Variant.product_id == "evo-01")))
    assert database_state(commerce_engine)["stock"] == before["stock"]


@pytest.mark.parametrize("identity_error", ["product", "handle", "variant", "duplicate", "empty"])
def test_unimported_or_ambiguous_snapshot_cannot_retire_catalog(commerce_engine, identity_error):
    source = sync_catalog.load_snapshot(CATALOG_PATH)
    if identity_error == "empty":
        source = []
    elif identity_error == "duplicate":
        source.append(source[0])
    else:
        source[0] = replace(
            source[0],
            **{
                "product": {"id": "unimported"},
                "handle": {"handle": "unimported"},
                "variant": {"sizes": (*source[0].sizes, 99)},
            }[identity_error],
        )
    before = database_state(commerce_engine)
    with pytest.raises(catalog_sync.CatalogSyncError):
        with Session(commerce_engine) as db, db.begin():
            catalog_sync.apply_availability(db, source, "unreviewed")
    assert database_state(commerce_engine) == before


@pytest.mark.parametrize("inactive_entity", ["product", "variant"])
def test_inactive_gate_covers_all_purchase_mutations_but_cart_can_be_removed(
    commerce, variant, inactive_entity
):
    client, engine = commerce
    added = client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 2})
    assert added.status_code == 200
    item = added.json()["items"][0]
    with Session(engine) as db, db.begin():
        model, key = (
            (Product, "evo-01") if inactive_entity == "product" else (Variant, variant["id"])
        )
        db.get(model, key).is_active = False
    before = database_state(engine)
    responses = [
        client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 1}),
        client.patch(f"/api/v1/cart/items/{item['id']}", json={"quantity": 1}),
        client.post("/api/v1/checkout/preview"),
        client.post("/api/v1/checkout/create-order", headers={"Idempotency-Key": "retired-order"}),
    ]
    assert all(
        r.status_code == 409 and r.json()["code"] == "variant_unavailable" for r in responses
    )
    cart = client.get("/api/v1/cart").json()
    assert cart["items"][0]["sellable"] is False
    assert cart["items"][0]["quantity"] == 2
    if inactive_entity == "product":
        assert client.get("/api/v1/catalog/products/dc-1001").status_code == 404
        assert "evo-01" not in {p["id"] for p in client.get("/api/v1/catalog/products").json()}
    else:
        product = client.get("/api/v1/catalog/products/dc-1001").json()
        assert variant["id"] not in {v["id"] for v in product["variants"]}
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 0
    assert database_state(engine) == before
    assert client.delete(f"/api/v1/cart/items/{item['id']}").json()["items"] == []


@pytest.mark.parametrize("release", ["cancel", "expiry"])
def test_retirement_preserves_order_snapshots_idempotency_and_stock_release(
    commerce, variant, release
):
    client, engine = commerce
    assert (
        client.post(
            "/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 2}
        ).status_code
        == 200
    )
    order = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": "historical-order"}
    ).json()
    apply_source(engine, source_without("evo-01"))
    retry = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": "historical-order"}
    )
    assert retry.status_code == 200
    assert retry.json() == order
    payment = client.post("/api/v1/payments/session", json={"order_id": order["id"]}).json()
    assert payment["charged"] is False
    assert payment["order_status"] == "pending_payment"
    if release == "cancel":
        response = client.post(f"/api/v1/orders/{order['id']}/cancel")
    else:
        assert (
            expire_due_orders(sessionmaker(engine), now=datetime.now(UTC) + timedelta(days=1)) == 1
        )
        response = client.get(f"/api/v1/orders/{order['id']}")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert response.json()["items"] == order["items"]
    assert response.json()["total"] == order["total"]
    assert client.post(f"/api/v1/orders/{order['id']}/cancel").json() == response.json()
    with Session(engine) as db:
        assert db.get(Product, "evo-01").is_active is False
        assert db.get(Variant, variant["id"]).is_active is False
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        assert db.scalar(select(Reservation)).status == "released"
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_released")
            )
            == 1
        )


def test_sqlite_cli_preview_is_read_only_and_does_not_create_database(
    commerce_engine, tmp_path, monkeypatch, capsys
):
    if commerce_engine.dialect.name != "sqlite":
        pytest.skip("SQLite read-only URI contract")
    path = tmp_path / "reviewed.json"
    exported = json.loads(CATALOG_PATH.read_text("utf-8"))
    path.write_text(json.dumps([p for p in exported if p["id"] != "evo-01"]), "utf-8")
    url = str(commerce_engine.url)
    monkeypatch.setattr(settings, "database_url", url)
    before = database_state(commerce_engine)
    assert sync_catalog.main(["--catalog", str(path)]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["applied"] is False
    assert result["changes"]
    assert database_state(commerce_engine) == before
    readonly = sync_catalog.sync_engine(url, apply=False)
    try:
        with pytest.raises(OperationalError, match="readonly"):
            with readonly.begin() as connection:
                connection.execute(text("UPDATE products SET is_active = 0"))
    finally:
        readonly.dispose()
    assert (
        sync_catalog.main(
            ["--catalog", str(path), "--apply", "--expect-plan", result["plan_version"]]
        )
        == 0
    )
    assert json.loads(capsys.readouterr().out)["applied"] is True
    applied = database_state(commerce_engine)
    assert applied["stock"] == before["stock"]
    with Session(commerce_engine) as db:
        assert db.get(Product, "evo-01").is_active is False
    assert (
        sync_catalog.main(
            ["--catalog", str(path), "--apply", "--expect-plan", result["plan_version"]]
        )
        == 1
    )
    assert json.loads(capsys.readouterr().err)["code"] == "catalog_sync_rejected"
    assert database_state(commerce_engine) == applied
    missing = tmp_path / "not-created.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{missing.as_posix()}")
    assert sync_catalog.main(["--catalog", str(path)]) == 1
    assert not missing.exists()
    assert json.loads(capsys.readouterr().err)["code"] == "catalog_sync_rejected"


@pytest.mark.parametrize(
    "invalid",
    [
        "[]",
        '[{"id":"secret-token","id":"other-id"}]',
        '[{"id":"secret-token","handle":"secret-handle","colors":[],"sizes":[true]}]',
        '[{"id":"secret-token","handle":"secret-handle","colors":[],"sizes":[38,38]}]',
        "secret-token-not-json",
        " " * 2_000_001,
    ],
    ids=[
        "empty",
        "duplicate-json-field",
        "coerced-size",
        "duplicate-size",
        "malformed",
        "oversize",
    ],
)
def test_cli_rejects_invalid_snapshot_without_exposing_input_or_database_url(
    tmp_path, monkeypatch, capsys, invalid
):
    path = tmp_path / "private-snapshot.json"
    path.write_text(invalid, "utf-8")
    monkeypatch.setattr(
        settings, "database_url", "postgresql://private-user:secret-password@private-db"
    )
    assert sync_catalog.main(["--catalog", str(path)]) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert json.loads(output.err)["code"] in {"catalog_sync_failed", "catalog_sync_rejected"}
    for private in ("secret-token", "secret-password", "private-user", "private-db", str(path)):
        assert private not in output.err


@pytest.mark.parametrize("first", ["retirement", "checkout"])
def test_retirement_and_checkout_have_a_deterministic_serial_order(
    commerce_engine, monkeypatch, first
):
    engine = commerce_engine
    product_id = "evo-01"
    product = next(p for p in sync_catalog.load_snapshot(CATALOG_PATH) if p.id == product_id)
    variant_id = stable_variant_id(product.handle, product.colors[0], product.sizes[0])
    session_id = str(uuid4())
    with Session(engine) as db, db.begin():
        commerce.lock_cart(db, session_id)
        db.add(CartItem(cart_id=session_id, variant_id=variant_id, quantity=2))
    source = source_without(product_id)
    with Session(engine) as db:
        plan = catalog_sync.plan_availability(db, source)
    held, contender_started, release = Event(), Event(), Event()
    worker = local()
    owner = catalog_sync if first == "retirement" else commerce
    original_lock = owner.lock_products

    def pause_after_product_lock(db, ids):
        original_lock(db, ids)
        held.set()
        assert release.wait(10), "Timed out waiting to release held product lock"

    def observe_contender(_connection, _cursor, statement, _parameters, _context, _many):
        # SQLite contenders wait at the first write due to the database-wide
        # writer lock; PostgreSQL contenders can enter their cart transaction
        # and must reach the product row lock before releasing the leader.
        contended_write = (
            statement.startswith(("INSERT", "UPDATE"))
            if engine.dialect.name == "sqlite"
            else statement.startswith("UPDATE products")
        )
        if getattr(worker, "contender", False) and contended_write:
            contender_started.set()

    monkeypatch.setattr(owner, "lock_products", pause_after_product_lock)
    event.listen(engine, "before_cursor_execute", observe_contender)

    def retire(is_contender=False):
        worker.contender = is_contender
        with Session(engine) as db, db.begin():
            return catalog_sync.apply_availability(db, source, plan.plan_version)

    def purchase(is_contender=False):
        worker.contender = is_contender
        with Session(engine) as db, db.begin():
            return commerce.create_order(db, session_id, "concurrent-retirement")

    leading, trailing = (retire, purchase) if first == "retirement" else (purchase, retire)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            leader = pool.submit(leading)
            try:
                assert held.wait(10), "Leading operation did not acquire its product lock"
                contender = pool.submit(trailing, True)
                assert contender_started.wait(10), (
                    "Contender did not enter its database transaction"
                )
                assert contender.done() is False
            finally:
                release.set()
            leader_result = leader.result(timeout=15)
            if first == "retirement":
                with pytest.raises(VariantUnavailable):
                    contender.result(timeout=15)
            else:
                assert leader_result["status"] == "pending_payment"
                contender.result(timeout=15)
    finally:
        release.set()
        event.remove(engine, "before_cursor_execute", observe_contender)
    with Session(engine) as db:
        assert db.get(Product, product_id).is_active is False
        assert db.get(Variant, variant_id).is_active is False
        stock = db.get(Inventory, variant_id)
        expected = (10, 0, 0) if first == "retirement" else (8, 2, 1)
        assert (
            stock.available,
            stock.reserved,
            db.scalar(select(func.count()).select_from(Order)),
        ) == expected
        assert db.scalar(select(func.count()).select_from(CartItem)) == (first == "retirement")
