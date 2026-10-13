from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain.states import ORDER_STATUSES, PAYMENT_STATUSES, RESERVATION_STATUSES, sql_in


def identifier() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    handle: Mapped[str] = mapped_column(String(100), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(4000))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())


class Variant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("product_id", "color", "size"),
        CheckConstraint("price >= 0"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    sku: Mapped[str] = mapped_column(String(160), unique=True)
    color: Mapped[str] = mapped_column(String(100))
    color_hex: Mapped[str] = mapped_column(String(7))
    size: Mapped[int]
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())


class Media(Base):
    __tablename__ = "product_media"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    color: Mapped[str | None] = mapped_column(String(100))
    position: Mapped[int]


class Cart(Base):
    __tablename__ = "carts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    revision: Mapped[int] = mapped_column(default=0)


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("cart_id", "variant_id"), CheckConstraint("quantity > 0"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    cart_id: Mapped[str] = mapped_column(ForeignKey("carts.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"))
    quantity: Mapped[int]


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (CheckConstraint("available >= 0"), CheckConstraint("reserved >= 0"))
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"), primary_key=True)
    available: Mapped[int]
    reserved: Mapped[int] = mapped_column(default=0)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("cart_id", "idempotency_key"),
        CheckConstraint(sql_in("status", ORDER_STATUSES), name="ck_orders_order_status"),
        CheckConstraint("total >= 0", name="ck_orders_total_non_negative"),
        Index("ix_orders_status_expires_at", "status", "expires_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    cart_id: Mapped[str] = mapped_column(ForeignKey("carts.id"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(30), default="pending_payment")
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(String(30))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("quantity > 0"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"))
    title: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(160))
    color: Mapped[str] = mapped_column(String(100))
    size: Mapped[int]
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    quantity: Mapped[int]


class Reservation(Base):
    __tablename__ = "inventory_reservations"
    __table_args__ = (
        UniqueConstraint("order_id", "variant_id"),
        CheckConstraint("quantity > 0", name="ck_inventory_reservations_quantity_positive"),
        CheckConstraint(
            sql_in("status", RESERVATION_STATUSES),
            name="ck_inventory_reservations_reservation_status",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"))
    quantity: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="active")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(sql_in("status", PAYMENT_STATUSES), name="ck_payments_payment_status"),
        Index("ix_payments_provider_reference", "provider_reference", unique=True),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), unique=True)
    provider: Mapped[str] = mapped_column(String(30), default="mock")
    status: Mapped[str] = mapped_column(String(30), default="disabled")
    provider_reference: Mapped[str | None] = mapped_column(String(200))
    payment_intent: Mapped[str | None] = mapped_column(String(200))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    succeeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id"))
    event: Mapped[str] = mapped_column(String(80))


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    __table_args__ = (UniqueConstraint("provider", "external_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    provider: Mapped[str] = mapped_column(String(50))
    external_id: Mapped[str] = mapped_column(String(200))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="received", server_default="received")
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    entity_id: Mapped[str] = mapped_column(String(80), index=True)
    action: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
