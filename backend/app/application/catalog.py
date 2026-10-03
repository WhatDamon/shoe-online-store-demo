"""Shared sale-state gate. Callers own the transaction and cart lock."""

from collections.abc import Iterable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.application.errors import VariantNotFound, VariantUnavailable
from app.domain.models import Product, Variant


def lock_products(db: Session, product_ids: Iterable[str]) -> None:
    # Sorted no-op writes are row locks on PostgreSQL and acquire SQLite's write
    # lock. Sync and purchases both lock products before reading current variants.
    for product_id in sorted(set(product_ids)):
        db.execute(
            update(Product)
            .where(Product.id == product_id)
            .values(is_active=Product.is_active)
            .execution_options(synchronize_session=False)
        )


def require_sellable(db: Session, variant_id: str) -> None:
    product_id = db.scalar(select(Variant.product_id).where(Variant.id == variant_id))
    if product_id is None:
        raise VariantNotFound()
    lock_products(db, [product_id])
    active = db.execute(
        select(Variant.is_active, Product.is_active)
        .join(Product, Variant.product_id == Product.id)
        .where(Variant.id == variant_id)
    ).one()
    if not all(active):
        raise VariantUnavailable()
