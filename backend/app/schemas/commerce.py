from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class Quantity(BaseModel):
    # Unknown fields, including forged prices/status, are deliberately ignored.
    quantity: int = Field(ge=1, le=99, strict=True)


class AddItem(Quantity):
    variant_id: UUID


class PaymentRequest(BaseModel):
    order_id: UUID


class StripeEventProjection(BaseModel):
    """The minimum of a Stripe event this store acts on.

    Stripe's signature is verified by the Next public route, which then forwards these
    fields only: Python never sees the raw event body. Unknown fields are deliberately
    ignored rather than rejected, so an unprojected field (email, billing address, payment
    method) is dropped at the boundary instead of reaching a row or a log.
    """

    id: Annotated[str, Field(min_length=1, max_length=200)]
    type: Annotated[str, Field(min_length=1, max_length=80)]
    # Required, not defaulted: the money state a Checkout Session settled in is part of the
    # event's meaning, and a forwarder that drops it would let a completion whose money has
    # not arrived read exactly like one that has. ``completed`` is only a fulfilment fact;
    # only ``paid`` says the money was captured.
    payment_status: Annotated[
        Literal["paid", "unpaid", "no_payment_required"], Field(max_length=20)
    ]
    order_id: UUID | None = None
    checkout_session_id: Annotated[str, Field(max_length=200)] | None = None
    payment_intent: Annotated[str, Field(max_length=200)] | None = None
    amount_total: int | None = None
    currency: Annotated[str, Field(pattern=r"^[a-z]{3}$")] | None = None
