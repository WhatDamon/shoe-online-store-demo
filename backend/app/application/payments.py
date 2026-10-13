"""Payment orchestration: the single owner of payment-session state.

Stripe is a payment channel, never a source of truth. Every state change here happens
inside the caller's cart lock and after re-reading the order, and every outbound call goes
through the :class:`StripeGateway` port, so the whole flow is provable without network
access.

``orders.status`` (fulfilment) and ``payments.status`` (money) are deliberately orthogonal,
and the invariant that ties them is *not* "``paid`` implies ``succeeded``": a refund Stripe
has not completed leaves the money at ``refund_pending`` while the order stays ``paid`` and
stays a sale to fulfil. The invariant is that ``orders.status='paid'`` means the money was
captured -- ``payments.status`` is one of ``succeeded``, ``refund_pending`` or ``refunded``
-- and that every reservation of that order is ``consumed``. ``REFUNDABLE_PAYMENT_STATUSES``
spells that set once, and every order view reports the money axis as ``payment_status``, so
no client has to infer it from the fulfilment axis. Which of the two refund states is
written comes from Stripe's own answer: only a Refund reported as ``succeeded`` completes
the refund, and every other status keeps the debt at ``refund_pending`` for the
compensation pass to finish.

All four ``payments/session`` codes are machine-readable HTTP 200 outcomes rather than
errors: ``payment_disabled`` (Stripe is off), ``payment_ready``, ``order_not_payable`` and
``currency_unsupported``. Ownership failures deliberately reuse the existing
``OrderNotFound`` 404 so another session's order stays indistinguishable from an unknown
one.
"""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.application.audit import audit
from app.application.errors import (
    CommerceError,
    PaymentNotRefundable,
    RefundFailed,
    RefundsUnavailable,
)
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
from app.infrastructure.database import SessionLocal

logger = logging.getLogger("commerce.payments")

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

# The money states a refund can act on. Nothing else has captured money to give back:
# ``disabled`` and ``requires_payment`` never charged anyone, so they have no refund.
REFUNDABLE_PAYMENT_STATUSES: tuple[str, ...] = ("succeeded", "refund_pending", "refunded")

# A failed refund attempt writes one of each: the rows themselves are the attempt record, so
# ``refund_attempts`` counts them without a counter column on ``payments``.
REFUND_FAILED_EVENT = "refund_failed"
REFUND_SUCCEEDED_EVENT = "refund_succeeded"

# The only refund status that has moved the money. Every other value Stripe can report
# (``pending``, ``requires_action``, ``failed``, ``canceled``) means the money is still the
# customer's, so the debt stays at ``refund_pending`` and stays a compensation candidate.
REFUND_SETTLED_STATUS = "succeeded"


def _log_event(level: int, event: str, **fields: str | int) -> None:
    try:
        logger.log(level, json.dumps(dict(event=event, **fields)))
    except Exception:
        # Observability is best-effort: a broken handler or filter must not change the
        # outcome of a refund or replace the refusal the caller must see. No key, session
        # reference, payment intent or amount reaches this line by construction.
        pass


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
class RefundResult:
    """The two fields of a Stripe Refund this store acts on.

    ``status`` is Stripe's own lifecycle value (``pending``, ``requires_action``,
    ``succeeded``, ``failed`` or ``canceled``) and it is what decides whether the money has
    actually moved; the id is the reference a reconciliation reads back.
    """

    id: str
    status: str


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

    def refund(self, *, payment_intent: str, idempotency_key: str) -> RefundResult: ...


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
    if payment is not None and payment.status == "refund_pending":
        # Stripe redelivers, and this money is already flagged as owed: like the ``paid``
        # branch above, a repeat delivery must change nothing, event and audit included.
        return ConfirmOutcome(status="refund_pending", order_id=order.id)
    payment = _record_captured_payment(db, order, payment, provider_reference, payment_intent)
    payment.status = "refund_pending"
    db.flush()
    db.add(PaymentEvent(payment_id=payment.id, event="payment_after_release"))
    audit(db, order.id, "payment_after_release", status=order.status)
    return ConfirmOutcome(status="refund_pending", order_id=order.id)


def refund_idempotency_key(order_id: str) -> str:
    """Derived from the order alone: every retry of one refund reaches Stripe under one key."""
    return f"refund:{order_id}"


def refund_attempts(db: Session, payment_id: str) -> int:
    """Count the recorded attempts for one payment, read from the attempt rows themselves."""
    return (
        db.scalar(
            select(func.count())
            .select_from(PaymentEvent)
            .where(
                PaymentEvent.payment_id == payment_id,
                PaymentEvent.event == REFUND_FAILED_EVENT,
            )
        )
        or 0
    )


def _record_refund_success(
    db: Session, order: Order, payment: Payment, refund_reference: str
) -> None:
    now = datetime.now(UTC)
    payment.status = "refunded"
    payment.refunded_at = now
    # The two axes move together: money that is back is no longer a sale to fulfil.
    order.status = "refunded"
    order.refunded_at = now
    db.flush()
    db.add(PaymentEvent(payment_id=payment.id, event=REFUND_SUCCEEDED_EVENT))
    # The gateway's own refund reference is what a reconciliation reads back. It is an
    # identifier, not a secret, exactly like the payment intent recorded on confirmation.
    audit(db, order.id, "refund_succeeded", status="refunded", refund_id=refund_reference)


def _record_refund_failure(
    db: Session,
    order: Order,
    payment: Payment,
    *,
    reason: str,
    refund: RefundResult | None = None,
) -> None:
    """Keep the money flagged as owed and count the attempt, without any payment detail.

    ``refund`` is the request Stripe did not settle: the audit carries its id and status,
    which are identifiers, so a reconciliation can read the later status back.
    """
    payment.status = "refund_pending"
    db.add(PaymentEvent(payment_id=payment.id, event=REFUND_FAILED_EVENT))
    db.flush()
    attempts = refund_attempts(db, payment.id)
    details: dict[str, object] = {
        "status": "refund_pending",
        "reason": reason,
        "attempts": attempts,
    }
    if refund is not None:
        # The exact Stripe refund that is still in flight, so a reconciliation can read its
        # later status back instead of this store opening a second refund for the same debt.
        details["refund_id"] = refund.id
        details["refund_status"] = refund.status
    audit(db, order.id, "refund_failed", **details)
    _log_event(logging.ERROR, "refund_failed", order_id=order.id, reason=reason, attempts=attempts)


def _attempt_refund(db: Session, order: Order, payment: Payment, gateway: StripeGateway) -> str:
    """Make one refund call through the gateway and record what happened to the money.

    A gateway fault is expected input, never an exception: it is recorded and reported as
    the resulting payment status, so the caller decides how to surface it. Returns the
    payment status after the attempt (``refunded`` or ``refund_pending``).
    """
    if payment.payment_intent is None:
        # Money captured without an intent cannot be handed to the gateway; recording the
        # failure keeps the debt visible instead of raising a TypeError into a 500.
        _record_refund_failure(db, order, payment, reason="missing_payment_intent")
        return "refund_pending"
    try:
        refund = gateway.refund(
            payment_intent=payment.payment_intent,
            idempotency_key=refund_idempotency_key(order.id),
        )
    except StripeGatewayError:
        _record_refund_failure(db, order, payment, reason="gateway_error")
        return "refund_pending"
    if refund.status != REFUND_SETTLED_STATUS:
        # Creating a Refund is a request, not a settlement. Writing ``refunded`` here would
        # claim money the customer has not received, move the order off ``paid`` while it is
        # still a sale to fulfil, and -- worst of all -- drop the debt off the rows the
        # compensation pass selects, so nothing would ever finish it.
        _record_refund_failure(db, order, payment, reason="refund_not_settled", refund=refund)
        return "refund_pending"
    _record_refund_success(db, order, payment, refund.id)
    return "refunded"


@dataclass(frozen=True)
class Refunded:
    """The money is back: ``order`` is the view the endpoint returns."""

    order: dict


@dataclass(frozen=True)
class RefundRefused:
    """No money moved: ``error`` is the refusal the route reports.

    A refusal is data instead of an exception because this layer must not own the caller's
    transaction: raising it would unwind that transaction and discard the failed-attempt
    record this store keeps until the money really is back.
    """

    error: CommerceError


# One refund request either moves the money or reports why it did not.
RefundOutcome = Refunded | RefundRefused


def refund_order(
    db: Session, session_id: str, order_id: str, *, gateway: StripeGateway | None = None
) -> RefundOutcome:
    """Refund the captured money of one owned order, reporting the outcome as data.

    Runs under the cart lock that every other order state change takes, and re-reads the
    order only after acquiring it. Ownership failures reuse the existing 404 so another
    session's order stays indistinguishable from an unknown one.

    A completed refund is idempotent. A refund that Stripe did not complete is the one
    outcome that must outlive the refusal it reports: this store still owes the money, so
    the failed attempt has to be committed by whoever owns the transaction. That owner is
    the caller, never this function, which is why the refusal is returned instead of
    raised -- raising it would unwind the caller's transaction and discard the attempt
    record with it. The retry itself belongs to the compensation pass, so this endpoint
    never opens a second Stripe refund for money it has already flagged as owed.
    """
    # Imported inside the function: commerce re-exports from this module (circular).
    from app.application.commerce import lock_cart, order_view, owned_order

    lock_cart(db, session_id)
    order = owned_order(db, session_id, order_id)
    payment = db.scalar(select(Payment).where(Payment.order_id == order.id))
    if payment is None or payment.status not in REFUNDABLE_PAYMENT_STATUSES:
        return RefundRefused(PaymentNotRefundable())
    if payment.status == "refunded":
        # Terminal money state: repeating the request reports the view it already produced.
        return Refunded(order_view(db, order))
    if payment.status == "refund_pending":
        # Already owed and already recorded: a third party never opens a second refund, and
        # reporting success here would claim money that has not moved.
        return RefundRefused(RefundFailed())
    if not settings.stripe_ready:
        # Refunds leave through the same channel as payments. A switched-off channel leaves
        # the money owed and refundable for a later pass, which is not the same statement as
        # "this payment can never be refunded".
        return RefundRefused(RefundsUnavailable())
    refunds = gateway if gateway is not None else default_gateway()
    if _attempt_refund(db, order, payment, refunds) != "refunded":
        return RefundRefused(RefundFailed())
    return Refunded(order_view(db, order))


def refund_pending_payments(
    sessions: sessionmaker[Session] = SessionLocal,
    *,
    limit: int = 100,
    gateway: StripeGateway | None = None,
) -> int:
    """One bounded compensation pass over money Stripe still owes back.

    Entry three of the refund design: a table plus a repeatable command, no worker fleet.
    Each attempt reuses the same per-order idempotency key, so a replay after a crash can
    never refund twice, and money that reached ``refunded`` is no longer a candidate.
    Candidates run in payment-id order, so a ``limit`` below the backlog still makes
    progress instead of retrying the same rows forever.

    The pass owns its sessions and commits each attempt on its own, exactly like
    ``expire_due_orders``: it shares no transaction with its caller, so a failed attempt
    stays recorded even though the pass reports the failure, and one candidate's failure
    rolls back nothing else.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("Refund batch size must be an integer from 1 to 1000")
    if not settings.stripe_ready:
        # Nothing can leave through a switched-off channel; the owed rows stay for an
        # operator to replay once a key is configured. No order detail goes into the log.
        _log_event(logging.WARNING, "refund_pass_disabled")
        return 0
    refunds = gateway if gateway is not None else default_gateway()
    # Freeze the candidates in their own short transaction: no write lock is held while
    # Stripe is being asked, and every attempt below commits separately.
    with sessions() as db, db.begin():
        candidates = db.execute(
            select(Payment.id, Payment.order_id)
            .join(Order, Payment.order_id == Order.id)
            .where(Payment.status == "refund_pending")
            .order_by(Payment.id)
            .limit(limit)
        ).all()
    refunded = 0
    failed = 0
    dropped = 0
    for payment_id, order_id in candidates:
        with sessions() as db, db.begin():
            payment = db.get(Payment, payment_id)
            order = db.get(Order, order_id)
            if payment is None or order is None or payment.status != "refund_pending":
                # The money moved between the candidate read and this attempt: the endpoint,
                # another pass or an operator got there first. Re-attempting it would rewrite
                # a terminal money state, so the row is left alone.
                dropped += 1
                continue
            status = _attempt_refund(db, order, payment, refunds)
        if status == "refunded":
            refunded += 1
        else:
            failed += 1
    if dropped:
        _log_event(logging.INFO, "refund_candidates_dropped", count=dropped)
    if failed:
        # Preserve the CLI failure signal only after the attempts are safe to keep.
        raise RuntimeError(f"Refund pass failed for {failed} payments") from None
    return refunded
