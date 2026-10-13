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

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.application.audit import audit
from app.config import settings
from app.domain.models import (
    Inventory,
    Order,
    OrderItem,
    Payment,
    PaymentEvent,
    Reservation,
)
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

# Money that has already left the customer. The stock of such an order may never go back on
# sale, whatever path reaches a release, so the confirmation and the release guard both
# read this one set instead of spelling the states out twice.
SETTLED_PAYMENT_STATUSES: tuple[str, ...] = ("succeeded", "refund_pending")


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


@dataclass(frozen=True)
class ConfirmOutcome:
    """Machine-readable result of one completed Checkout Session."""

    status: str  # 'paid' | 'refund_pending' | 'already_paid' | 'ignored'
    order_id: str


def confirm_payment(
    db: Session, *, order_id: str, provider_reference: str, payment_intent: str | None
) -> ConfirmOutcome:
    """Record captured money for an order and consume the reservation it bought.

    Runs in the caller's transaction under the same cart lock that checkout, customer
    cancellation and the expiry sweep take, and re-reads the order only after acquiring it,
    so a concurrent release can at worst be observed as an already-committed ``cancelled``
    order. No branch here can make a released order fulfilable again: money that arrived
    after the stock was released becomes ``refund_pending``, which is the only signal in
    the system that this customer is owed money.
    """
    # Imported inside the function: commerce re-exports from this module (circular).
    from app.application.commerce import lock_cart

    order = db.scalar(select(Order).where(Order.id == order_id))
    if order is None:
        # A session this store never opened, or a replay from another environment.
        return ConfirmOutcome(status="ignored", order_id=order_id)
    lock_cart(db, order.cart_id)
    # Every branch below is decided on this read, taken inside the lock. The instance was
    # loaded before the lock, so it is reloaded from the database rather than trusted.
    db.refresh(order)
    owner = db.scalar(
        select(Payment.order_id).where(Payment.provider_reference == provider_reference)
    )
    if owner is not None and owner != order_id:
        # This session's money belongs to another order: confirming it here would both
        # mislabel someone else's payment and break the unique session reference.
        return ConfirmOutcome(status="ignored", order_id=order_id)
    payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
    if order.status == "paid":
        # Stripe redelivers, and the money is already recorded: nothing may change.
        return ConfirmOutcome(status="already_paid", order_id=order_id)
    if order.status == "cancelled":
        return _payment_after_release(db, order, payment, provider_reference, payment_intent)
    if order.status != "pending_payment":
        # ``refunded`` is terminal, and a refunded order must never be resurrected.
        return ConfirmOutcome(status="ignored", order_id=order_id)
    # An order can still be ``pending_payment`` while ``expires_at`` has passed: the sweep
    # has not won the cart lock yet, so its reservation is still ``active`` and the stock
    # was never put back on sale. Confirming it is the fulfil side of the documented
    # ``checkout.session.completed`` vs. release race, and it is the only side that leaves a
    # consistent state: turning it into a refund would strand a reservation the sweep can no
    # longer clean up, because the release guard refuses to touch a settled payment.
    return _consume_and_confirm(db, order, payment, provider_reference, payment_intent)


def _record_captured_payment(
    db: Session,
    order: Order,
    payment: Payment | None,
    provider_reference: str,
    payment_intent: str | None,
) -> Payment:
    """Freeze the reference that actually paid onto the order's single money row."""
    if payment is None:
        # Money arrived without a recorded session: record it instead of losing the fact
        # that it was captured.
        payment = Payment(order_id=order.id)
        db.add(payment)
    payment.provider = "stripe"
    payment.provider_reference = provider_reference
    if payment_intent is not None:
        payment.payment_intent = payment_intent
    # The amount was frozen when the session was created; only fill a missing one.
    if payment.amount is None:
        payment.amount = order.total
    if payment.currency is None:
        payment.currency = (order.currency or "").upper()
    return payment


def _consume_and_confirm(
    db: Session,
    order: Order,
    payment: Payment | None,
    provider_reference: str,
    payment_intent: str | None,
) -> ConfirmOutcome:
    """Turn the active holds into sales, then mark the order paid."""
    reservations = db.scalars(
        select(Reservation)
        .where(Reservation.order_id == order.id, Reservation.status == "active")
        .order_by(Reservation.variant_id)
    ).all()
    lines = db.scalar(
        select(func.count()).select_from(OrderItem).where(OrderItem.order_id == order.id)
    )
    if len(reservations) != lines:
        # Every line must still be held; a mismatch means the stock cannot be certified as
        # sold, so the caller's transaction rolls back instead of marking the order paid.
        raise RuntimeError("Payment confirmation could not consume every reservation")
    now = datetime.now(UTC)
    for reservation in reservations:
        changed = db.execute(
            update(Inventory)
            .where(
                Inventory.variant_id == reservation.variant_id,
                Inventory.reserved >= reservation.quantity,
            )
            # The quantity left ``available`` when the order was created; confirming only
            # drops the hold, so ``available`` must stay untouched.
            .values(reserved=Inventory.reserved - reservation.quantity)
        )
        if changed.rowcount != 1:  # type: ignore[attr-defined]
            raise RuntimeError("Payment confirmation could not consume every reservation")
        reservation.status = "consumed"
        audit(
            db,
            reservation.variant_id,
            "inventory_consumed",
            order_id=order.id,
            quantity=reservation.quantity,
        )
    payment = _record_captured_payment(db, order, payment, provider_reference, payment_intent)
    payment.status = "succeeded"
    payment.succeeded_at = now
    db.flush()
    db.add(PaymentEvent(payment_id=payment.id, event="payment_succeeded"))
    order.status = "paid"
    order.paid_at = now
    # A paid order has no reservation deadline left to sweep.
    order.expires_at = None
    db.flush()
    audit(db, order.id, "payment_confirmed", status="paid", total=str(order.total))
    return ConfirmOutcome(status="paid", order_id=order.id)


def _payment_after_release(
    db: Session,
    order: Order,
    payment: Payment | None,
    provider_reference: str,
    payment_intent: str | None,
) -> ConfirmOutcome:
    """Money captured for an order whose reservation was already released.

    The order stays ``cancelled``: it must never become fulfilable again, and the money is
    marked as owed back, which is the signal the refund path and the compensation command
    read.
    """
    payment = _record_captured_payment(db, order, payment, provider_reference, payment_intent)
    payment.status = "refund_pending"
    db.flush()
    db.add(PaymentEvent(payment_id=payment.id, event="payment_after_release"))
    audit(db, order.id, "payment_after_release", status=order.status)
    return ConfirmOutcome(status="refund_pending", order_id=order.id)
