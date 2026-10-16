"""Stripe SDK adapter: the only module that knows the SDK's request shapes.

The secret key is read from settings here and is never passed through the request path,
returned to a caller or logged. Only the timeout and the key are configured; request
bodies, URLs and provider error messages stay out of logs. The SDK's own logger is silenced
for the same reason it exists elsewhere: it logs every request URL and response body, and a
retrieved session id in a URL or a provider error echoed from a response body is exactly the
detail the application log is built to keep out.
"""

import logging
from datetime import datetime

import stripe

from app.application.payments import (
    CheckoutLineItem,
    CheckoutSession,
    RefundResult,
    StripeGatewayError,
)
from app.config import settings

# Every Checkout Session this store opens takes cards only. The alternative -- leaving the
# method list out and accepting whatever the Stripe account has enabled -- would let a
# customer pick a method that settles after ``checkout.session.completed``, which is the
# state this store cannot fulfil on (MVP: see the ``payment_status`` guard in webhooks).
# The parameter is ``allowed_payment_method_types``: the API version this SDK targets
# (``2026-09-30.endive``) accepts that name on create, while ``payment_method_types`` is a
# read-only field of the Session resource there.
PAYMENT_METHOD_TYPES = ("card",)


def session_view(session: "stripe.checkout.Session") -> CheckoutSession:
    """Project an SDK session onto the fields the application depends on."""
    return CheckoutSession(id=session.id, url=session.url, status=session.status or "unknown")


class SdkStripeGateway:
    """Thin wrapper over the Stripe SDK behind the application's gateway port."""

    def __init__(self) -> None:
        # Configuration only: constructing the gateway performs no network I/O.
        stripe.api_key = settings.stripe_secret_key
        stripe.default_http_client = stripe.new_default_http_client(
            timeout=settings.stripe_api_timeout_seconds
        )
        # The SDK logs request URLs, response bodies and provider error text through the
        # ``stripe`` logger. Raising its level stops those records from being created at all,
        # and ``propagate`` keeps anything the SDK might one day log at ERROR out of the
        # root/application log as well. Both apply to the whole ``stripe`` logger namespace
        # and to nothing else: this module's own ``commerce.*`` loggers are untouched.
        sdk_logger = logging.getLogger("stripe")
        sdk_logger.setLevel(logging.ERROR)
        sdk_logger.propagate = False

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
    ) -> CheckoutSession:
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                client_reference_id=order_id,
                # Reconciliation anchor: the webhook handler finds the order by this id.
                payment_intent_data={"metadata": {"order_id": order_id}},
                allowed_payment_method_types=list(PAYMENT_METHOD_TYPES),
                line_items=[
                    {
                        "quantity": item.quantity,
                        "price_data": {
                            "currency": currency.lower(),
                            "unit_amount": item.unit_amount,
                            "product_data": {"name": item.name},
                        },
                    }
                    for item in line_items
                ],
                expires_at=int(expires_at.timestamp()),
                success_url=success_url,
                cancel_url=cancel_url,
                idempotency_key=idempotency_key,
            )
        except stripe.StripeError as error:
            raise StripeGatewayError("Stripe checkout session creation failed") from error
        return session_view(session)

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSession | None:
        try:
            session = stripe.checkout.Session.retrieve(session_id)
        except stripe.InvalidRequestError:
            # The stored session no longer exists, so the caller may open a new one.
            return None
        except stripe.StripeError as error:
            # Anything else (network, auth) must not be read as "gone": opening a second
            # session on a transient failure would double-charge the customer.
            raise StripeGatewayError("Stripe checkout session retrieval failed") from error
        return session_view(session)

    def refund(self, *, payment_intent: str, idempotency_key: str) -> RefundResult:
        try:
            refund = stripe.Refund.create(
                payment_intent=payment_intent, idempotency_key=idempotency_key
            )
        except stripe.StripeError as error:
            raise StripeGatewayError("Stripe refund failed") from error
        # The status travels with the reference: creating a Refund is a request, and only
        # the application layer may decide what a non-``succeeded`` one means. A missing
        # status is reported as ``unknown`` rather than guessed at, so it cannot be mistaken
        # for a completed refund.
        return RefundResult(id=refund.id, status=refund.status or "unknown")
