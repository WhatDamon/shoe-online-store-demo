"""Stripe SDK adapter: the only module that knows the SDK's request shapes.

The secret key is read from settings here and is never passed through the request path,
returned to a caller or logged. Only the timeout and the key are configured; request
bodies, URLs and provider error messages stay out of logs.
"""

from datetime import datetime

import stripe

from app.application.payments import CheckoutLineItem, CheckoutSession, StripeGatewayError
from app.config import settings


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

    def refund(self, *, payment_intent: str, idempotency_key: str) -> str:
        try:
            refund = stripe.Refund.create(
                payment_intent=payment_intent, idempotency_key=idempotency_key
            )
        except stripe.StripeError as error:
            raise StripeGatewayError("Stripe refund failed") from error
        return refund.id
