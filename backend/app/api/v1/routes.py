from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.catalog import require_sellable
from app.application.commerce import (
    cancel_order,
    cart_view,
    create_order,
    expire_if_due,
    lock_cart,
    order_view,
    owned_order,
)
from app.application.errors import (
    CartItemNotFound,
    ProductNotFound,
    QuantityLimitExceeded,
)
from app.application.payments import RefundRefused, create_payment_session, refund_order
from app.application.webhooks import ingest_event
from app.dependencies import anonymous_session, database, internal_proxy
from app.domain.models import CartItem, Inventory, Media, Product, Variant
from app.schemas.commerce import AddItem, PaymentRequest, Quantity, StripeEventProjection
from app.schemas.responses import CartResponse, OrderResponse, PaymentResponse, ProductResponse

router = APIRouter(prefix="/api/v1", dependencies=[Depends(internal_proxy)])
DB = Annotated[Session, Depends(database, scope="function")]
SessionID = Annotated[str, Depends(anonymous_session)]


def _product_payload(
    product: Product,
    variants_by_product: dict[str, list[tuple[Variant, Inventory]]],
    media_by_product: dict[str, list[Media]],
) -> dict:
    return dict(
        id=product.id,
        handle=product.handle,
        title=product.title,
        description=product.description,
        media=[dict(url=m.url, color=m.color) for m in media_by_product.get(product.id, [])],
        variants=[
            dict(
                id=v.id,
                sku=v.sku,
                color=v.color,
                color_hex=v.color_hex,
                size=v.size,
                price=str(v.price),
                currency=v.currency,
                available=i.available,
            )
            for v, i in variants_by_product.get(product.id, [])
        ],
    )


def product_views(db: Session, products: list[Product]) -> list[dict]:
    if not products:
        return []
    product_ids = [product.id for product in products]
    variants_by_product: dict[str, list[tuple[Variant, Inventory]]] = {
        product_id: [] for product_id in product_ids
    }
    for variant, inventory in db.execute(
        select(Variant, Inventory)
        .join(Inventory)
        .where(
            Variant.product_id.in_(product_ids),
            Variant.is_active.is_(True),
        )
        .order_by(Variant.product_id, Variant.color, Variant.size)
    ).all():
        variants_by_product[variant.product_id].append((variant, inventory))

    media_by_product: dict[str, list[Media]] = {product_id: [] for product_id in product_ids}
    for media in db.scalars(
        select(Media)
        .where(Media.product_id.in_(product_ids))
        .order_by(Media.product_id, Media.position)
    ).all():
        media_by_product[media.product_id].append(media)

    return [
        _product_payload(product, variants_by_product, media_by_product) for product in products
    ]


def product_view(db: Session, product: Product) -> dict:
    return product_views(db, [product])[0]


@router.get("/catalog/products", response_model=list[ProductResponse])
def products(db: DB) -> list[dict]:
    active_products = list(
        db.scalars(select(Product).where(Product.is_active.is_(True)).order_by(Product.handle))
    )
    return product_views(db, active_products)


@router.get("/catalog/products/{handle}", response_model=ProductResponse)
def product(handle: str, db: DB) -> dict:
    p = db.scalar(select(Product).where(Product.handle == handle, Product.is_active.is_(True)))
    if p is None:
        raise ProductNotFound()
    return product_view(db, p)


@router.get("/cart", response_model=CartResponse)
def cart(db: DB, sid: SessionID) -> dict:
    return cart_view(db, sid)


@router.post("/cart/items", response_model=CartResponse)
def add_item(body: AddItem, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    variant_id = str(body.variant_id)
    require_sellable(db, variant_id)
    item = db.scalar(
        select(CartItem).where(CartItem.cart_id == sid, CartItem.variant_id == variant_id)
    )
    quantity = body.quantity + (item.quantity if item else 0)
    if quantity > 99:
        raise QuantityLimitExceeded()
    if item:
        item.quantity = quantity
    else:
        db.add(CartItem(cart_id=sid, variant_id=variant_id, quantity=quantity))
    db.flush()
    return cart_view(db, sid)


def owned_item(db: Session, sid: str, item_id: str) -> CartItem:
    item = db.scalar(select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == sid))
    if item is None:
        raise CartItemNotFound()
    return item


@router.patch("/cart/items/{item_id}", response_model=CartResponse)
def patch_item(item_id: str, body: Quantity, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    item = owned_item(db, sid, item_id)
    require_sellable(db, item.variant_id)
    item.quantity = body.quantity
    db.flush()
    return cart_view(db, sid)


@router.delete("/cart/items/{item_id}", response_model=CartResponse)
def delete_item(item_id: str, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    db.delete(owned_item(db, sid, item_id))
    db.flush()
    return cart_view(db, sid)


@router.post("/checkout/preview", response_model=CartResponse)
def preview(db: DB, sid: SessionID) -> dict:
    return cart_view(db, sid, check_stock=True)


@router.post("/checkout/create-order", response_model=OrderResponse)
def checkout(
    db: DB, sid: SessionID, idempotency_key: Annotated[str, Header(min_length=8, max_length=128)]
) -> dict:
    return create_order(db, sid, idempotency_key)


@router.get("/orders/{order_id}", response_model=OrderResponse)
def get_order(order_id: str, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    order = owned_order(db, sid, order_id)
    expire_if_due(db, order)
    return order_view(db, order)


@router.post("/orders/{order_id}/cancel", response_model=OrderResponse)
def cancel(order_id: str, db: DB, sid: SessionID) -> dict:
    return cancel_order(db, sid, order_id)


@router.post("/orders/{order_id}/refund", response_model=OrderResponse)
def refund(order_id: str, db: DB, sid: SessionID, request: Request) -> Response | dict:
    # Same ownership contract as cancel: another session's order is a plain 404.
    outcome = refund_order(db, sid, order_id)
    if isinstance(outcome, RefundRefused):
        # Report the refusal instead of raising it: an exception would unwind this request's
        # transaction and discard the failed refund attempt it just recorded, and that debt
        # is what the compensation pass retries. ``app.main`` imports this module to register
        # the router, so the shared response helper can only be imported here.
        from app.main import error_response

        refusal = outcome.error
        return error_response(request, refusal.status_code, refusal.code, refusal.message)
    return outcome.order


@router.post("/payments/session", response_model=PaymentResponse)
def payment(body: PaymentRequest, db: DB, sid: SessionID, response: Response) -> dict:
    response.status_code = 200  # Machine-readable outcome, never a payment success.
    return asdict(create_payment_session(db, sid, str(body.order_id)))


@router.post("/webhooks/stripe", response_model=None)
def stripe_webhook(projection: StripeEventProjection, db: DB, request: Request) -> Response | dict:
    """Ingest one projected Stripe event forwarded by the Next public route.

    The signature was verified there, against ``STRIPE_WEBHOOK_SECRET``, and the body is
    already the projection this store acts on; the raw event never reaches Python. Like
    every other ``/api/v1`` route this one is protected by the internal proxy credential,
    because it only ever accepts this repository's own server as a caller.

    A processing failure is deliberately answered with a non-2xx. Stripe retries a delivery
    it could not acknowledge, and folding this failure into a 2xx would silently drop a
    payment this store has already taken money for. That is why this route reports the
    failure instead of raising it: raising would roll back the ``failed`` record the retry
    needs, leaving nothing to explain the lost event.
    """
    result = ingest_event(db, projection)
    if result.status == "failed":
        # Imported here for the same reason as the refund route does it: ``app.main``
        # imports this module to register the router.
        from app.main import error_response

        return error_response(
            request, 500, "webhook_processing_failed", "The event could not be processed"
        )
    return {
        "status": result.status,
        "event_id": result.event_id,
        "order_id": result.order_id,
    }
