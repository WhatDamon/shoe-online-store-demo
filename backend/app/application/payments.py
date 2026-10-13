"""Payment orchestration: the single owner of payment-session state.

Stripe is a payment channel, never a source of truth. Every state change here happens
inside the caller's cart lock and after re-reading the order, and every outbound call goes
through the :class:`StripeGateway` port, so the whole flow is provable without network
access.

All four ``payments/session`` codes are machine-readable HTTP 200 outcomes rather than
errors: ``payment_disabled`` (Stripe is off), ``payment_ready``, ``order_not_payable`` and
``currency_unsupported``. Ownership failures deliberately reuse the existing
``OrderNotFound`` 404 so another session's order stays indistinguishable from an unknown
one.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.audit import audit
from app.config import settings
from app.domain.models import Order, OrderItem, Payment, PaymentEvent
from app.domain.money import (
    MINIMUM_CHARGE_MINOR,
    SUPPORTED_CURRENCIES,
    is_chargeable,
    order_total_from_items,
    to_minor_units,
)

# Stripe only accepts a Checkout Session expiry between 30 minutes and 24 hours from
# creation. The local reservation is the shorter of the two, so Stripe must never be given
# a window that outlives it: a customer who can still pay after the stock was released is
# the failure this window exists to prevent (review focus 1).
MIN_CHECKOUT_WINDOW = timedelta(minutes=30)
MAX_CHECKOUT_WINDOW = timedelta(hours=24)

DISABLED_MESSAGE = "Payments are not available yet."
READY_MESSAGE = "Complete your payment to confirm this order."
NOT_PAYABLE_MESSAGE = "This order can no longer be paid. Please start a new order."
CURRENCY_MESSAGE = "This store cannot charge in this currency."


@dataclass(frozen=True)
class CheckoutSession:
    """The subset of a Stripe Checkout Session that commerce depends on."""

    id: str
    url: str | None
    status: str


@dataclass(frozen=True)
class CheckoutLineItem:
    """One line to charge, with the amount already converted to minor units."""

    name: str
    unit_amount: int
    quantity: int


@dataclass(frozen=True)
class PaymentSession:
    """Machine-readable outcome of ``payments/session``."""

    code: str
    payment_enabled: bool
    provider: str
    order_id: str
    order_status: str
    redirect_url: str | None
    message: str


class StripeGatewayError(RuntimeError):
    """An outbound Stripe call failed; carries no request body, key or provider message."""


class StripeGateway(Protocol):
    """Outbound Stripe calls, so payment logic is testable without network access."""

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
    ) -> CheckoutSession: ...

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSession | None: ...

    def refund(self, *, payment_intent: str, idempotency_key: str) -> str: ...


def default_gateway() -> StripeGateway:
    """The production gateway.

    Imported inside the function because ``stripe_gateway`` imports this module's protocol
    types; a module-level edge would be circular.
    """
    from app.infrastructure.stripe_gateway import SdkStripeGateway

    return SdkStripeGateway()


def checkout_expires_at(order_expires_at: datetime, *, now: datetime) -> datetime:
    """Align Stripe's checkout expiry with the order's reservation."""
    return min(max(order_expires_at, now + MIN_CHECKOUT_WINDOW), now + MAX_CHECKOUT_WINDOW)


def order_lines(db: Session, order: Order) -> list[OrderItem]:
    return list(
        db.scalars(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id))
    )


def checkout_url(site_url: str, order_id: str, outcome: str) -> str:
    return f"{site_url.rstrip('/')}/orders/{order_id}?payment={outcome}"


class MockPaymentProvider:
    """The disabled-provider path: records the attempt, never charges.

    Its return shape stays the dict the pre-Stripe endpoint returned (minus the removed
    ``charged`` key), so with Stripe off the wire response is unchanged.
    """

    def create_session(self, db: Session, order: Order) -> dict:
        payment = db.scalar(select(Payment).where(Payment.order_id == order.id))
        if payment is None:
            payment = Payment(order_id=order.id)
            db.add(payment)
            db.flush()
            db.add(PaymentEvent(payment_id=payment.id, event="payment_disabled"))
        return dict(
            code="payment_disabled",
            payment_enabled=False,
            provider="mock",
            order_id=order.id,
            order_status=order.status,
            redirect_url=None,
            message=DISABLED_MESSAGE,
        )


class StripePaymentProvider:
    """Creates or reuses one Stripe Checkout Session for an order that is ready to pay."""

    def __init__(self, gateway: StripeGateway) -> None:
        self._gateway = gateway

    def create_session(
        self, db: Session, order: Order, *, deadline: datetime | None, now: datetime
    ) -> PaymentSession:
        if order.status != "pending_payment":
            return self._not_payable(order)
        if deadline is None or deadline - now < MIN_CHECKOUT_WINDOW:
            return self._not_payable(order)
        # The order lines are the amount source; a total that disagrees with them is a data
        # fault, so it is refused before any outbound call.
        items = order_lines(db, order)
        recomputed = order_total_from_items([(item.unit_price, item.quantity) for item in items])
        if recomputed != order.total:
            return self._not_payable(order)
        # Stripe speaks lowercase currency codes, the money constants are uppercase.
        # Membership on those public constants decides the outcome, so no conversion error
        # can turn a controlled result into a 500.
        currency = (order.currency or "").upper()
        if currency not in SUPPORTED_CURRENCIES or currency not in MINIMUM_CHARGE_MINOR:
            return self._unsupported_currency(order)
        if not is_chargeable(order.total, currency):
            return self._not_payable(order)

        payment = db.scalar(select(Payment).where(Payment.order_id == order.id))
        if (
            payment is not None
            and payment.status == "requires_payment"
            and payment.provider_reference
        ):
            existing = self._gateway.retrieve_checkout_session(payment.provider_reference)
            if existing is not None and existing.status == "open" and existing.url:
                # A repeated request returns the session Stripe already holds instead of
                # opening a second one for the same order.
                return self._ready(order, existing.url)
        created = self._gateway.create_checkout_session(
            order_id=order.id,
            currency=currency,
            line_items=self._line_items(items, currency),
            expires_at=checkout_expires_at(deadline, now=now),
            success_url=checkout_url(settings.public_site_url, order.id, "success"),
            cancel_url=checkout_url(settings.public_site_url, order.id, "cancelled"),
            idempotency_key=f"checkout-session:{order.id}",
        )
        self._record(db, order, payment, currency, created.id, now)
        return self._ready(order, created.url)

    @staticmethod
    def _line_items(items: list[OrderItem], currency: str) -> list[CheckoutLineItem]:
        return [
            CheckoutLineItem(
                name=item.title,
                unit_amount=to_minor_units(item.unit_price, currency),
                quantity=item.quantity,
            )
            for item in items
        ]

    @staticmethod
    def _record(
        db: Session,
        order: Order,
        payment: Payment | None,
        currency: str,
        provider_reference: str,
        now: datetime,
    ) -> None:
        if payment is None:
            payment = Payment(order_id=order.id)
            db.add(payment)
        payment.provider = "stripe"
        payment.status = "requires_payment"
        payment.provider_reference = provider_reference
        payment.amount = order.total
        payment.currency = currency
        payment.created_at = now
        db.flush()
        db.add(PaymentEvent(payment_id=payment.id, event="payment_session_created"))
        audit(
            db,
            order.id,
            "payment_session_created",
            provider="stripe",
            amount=str(order.total),
            currency=currency,
        )

    @staticmethod
    def _ready(order: Order, redirect_url: str | None) -> PaymentSession:
        # A hosted session always carries a URL; the response contract rejects
        # ``payment_ready`` without one, so a missing URL can never be reported as ready.
        return StripePaymentProvider._outcome(order, "payment_ready", READY_MESSAGE, redirect_url)

    @staticmethod
    def _not_payable(order: Order) -> PaymentSession:
        return StripePaymentProvider._outcome(order, "order_not_payable", NOT_PAYABLE_MESSAGE)

    @staticmethod
    def _unsupported_currency(order: Order) -> PaymentSession:
        return StripePaymentProvider._outcome(order, "currency_unsupported", CURRENCY_MESSAGE)

    @staticmethod
    def _outcome(
        order: Order, code: str, message: str, redirect_url: str | None = None
    ) -> PaymentSession:
        # ``payment_enabled`` reports whether this store can take payments at all, matching
        # /health and the order view; ``code`` says whether *this* order can be paid.
        return PaymentSession(
            code=code,
            payment_enabled=True,
            provider="stripe",
            order_id=order.id,
            order_status=order.status,
            redirect_url=redirect_url,
            message=message,
        )


def create_payment_session(
    db: Session, session_id: str, order_id: str, *, gateway: StripeGateway | None = None
) -> PaymentSession:
    """Create or reuse the payment session for one owned order.

    Runs inside the caller's transaction under the cart lock. With Stripe disabled the
    disabled path takes over and no outbound call is made at all.
    """
    # Imported inside the function: commerce re-exports MockPaymentProvider from this
    # module, so a module-level edge would be circular.
    from app.application.commerce import as_utc, expire_if_due, lock_cart, owned_order

    lock_cart(db, session_id)
    order = owned_order(db, session_id, order_id)
    expire_if_due(db, order)
    if not settings.stripe_ready:
        return PaymentSession(**MockPaymentProvider().create_session(db, order))
    provider = StripePaymentProvider(gateway if gateway is not None else default_gateway())
    return provider.create_session(
        db,
        order,
        deadline=as_utc(order.expires_at) if order.expires_at else None,
        now=datetime.now(UTC),
    )
