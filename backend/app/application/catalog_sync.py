"""Explicit availability reconciliation; never imports prices or touches stock."""

import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.application.audit import audit
from app.application.catalog import lock_products
from app.domain.catalog_identity import CatalogIdentity, stable_variant_id
from app.domain.models import Product, Variant


class CatalogSyncError(ValueError):
    pass


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    ).hexdigest()


@dataclass(frozen=True)
class AvailabilityChange:
    entity: Literal["product", "variant"]
    id: str
    before: bool
    after: bool


@dataclass(frozen=True)
class AvailabilityPlan:
    source_version: str
    plan_version: str
    restore_present: bool
    changes: tuple[AvailabilityChange, ...]


def plan_availability(
    db: Session, source: list[CatalogIdentity], *, restore_present: bool = False
) -> AvailabilityPlan:
    products = [
        dict(row)
        for row in db.execute(
            select(Product.id, Product.handle, Product.is_active).order_by(Product.id)
        ).mappings()
    ]
    variants = [
        dict(row)
        for row in db.execute(
            select(
                Variant.id, Variant.product_id, Variant.color, Variant.size, Variant.is_active
            ).order_by(Variant.id)
        ).mappings()
    ]
    wanted = {p.id: p for p in source}
    handles = {p.handle for p in source}
    if not source or len(wanted) != len(source) or len(handles) != len(source):
        raise CatalogSyncError("Snapshot must contain unique product IDs and handles")
    by_id = {p["id"]: p for p in products}
    known_variants = {v["id"] for v in variants}
    for p in source:
        existing = by_id.get(p.id)
        if existing is None or existing["handle"] != p.handle:
            raise CatalogSyncError("Import or explicitly migrate product identities before syncing")
        if not p.variant_ids() <= known_variants:
            raise CatalogSyncError("Import or explicitly migrate variant identities before syncing")
    for v in variants:
        expected = stable_variant_id(by_id[v["product_id"]]["handle"], v["color"], v["size"])
        if v["id"] != expected:
            raise CatalogSyncError("Stored variant identity does not match the import contract")

    normalized = [
        {"id": p.id, "handle": p.handle, "variants": sorted(p.variant_ids())}
        for p in sorted(source, key=lambda p: p.id)
    ]
    source_version = digest(normalized)
    desired_variants = {variant_id for p in source for variant_id in p.variant_ids()}
    changes = []
    for entity, rows, desired in (
        ("product", products, set(wanted)),
        ("variant", variants, desired_variants),
    ):
        for row in rows:
            present = row["id"] in desired
            after = present if restore_present else row["is_active"] and present
            if row["is_active"] != after:
                changes.append(AvailabilityChange(entity, row["id"], row["is_active"], after))  # type: ignore[arg-type]
    plan_version = digest(
        {
            "source_version": source_version,
            "restore_present": restore_present,
            "products": products,
            "variants": variants,
        }
    )
    return AvailabilityPlan(source_version, plan_version, restore_present, tuple(changes))


def apply_availability(
    db: Session, source: list[CatalogIdentity], expected_plan: str, *, restore_present: bool = False
) -> AvailabilityPlan:
    # Same product locks as cart mutations and checkout, always in ID order.
    # Recompute only AFTER locks: a stale preview cannot overwrite a newer state.
    lock_products(db, db.scalars(select(Product.id).order_by(Product.id)))
    plan = plan_availability(db, source, restore_present=restore_present)
    if plan.plan_version != expected_plan:
        raise CatalogSyncError("Plan changed; preview again before applying")
    for change in plan.changes:
        model = Product if change.entity == "product" else Variant
        db.execute(update(model).where(model.id == change.id).values(is_active=change.after))
        audit(
            db,
            change.id,
            "catalog_availability_changed",
            entity_type=change.entity,
            before=change.before,
            after=change.after,
            source_version=plan.source_version,
            plan_version=plan.plan_version,
        )
    db.flush()
    return plan
