"""Framework-independent commerce failures.

The application layer raises these typed errors so HTTP, CLI, expiry workers,
and unit tests can share the same business rules without importing FastAPI.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CommerceError(Exception):
    code: str
    status_code: int
    message: str

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)


class ProductNotFound(CommerceError):
    def __init__(self) -> None:
        super().__init__("product_not_found", 404, "Product not found")


class VariantNotFound(CommerceError):
    def __init__(self) -> None:
        super().__init__("variant_not_found", 404, "Variant not found")


class OrderNotFound(CommerceError):
    def __init__(self) -> None:
        super().__init__("order_not_found", 404, "Order not found")


class VariantUnavailable(CommerceError):
    def __init__(self) -> None:
        super().__init__(
            "variant_unavailable", 409, "This item is no longer available for purchase"
        )


class EmptyCart(CommerceError):
    def __init__(self) -> None:
        super().__init__("empty_cart", 409, "Cart is empty")


class InsufficientStock(CommerceError):
    def __init__(self) -> None:
        super().__init__("insufficient_stock", 409, "Insufficient stock")


class QuantityLimitExceeded(CommerceError):
    def __init__(self) -> None:
        super().__init__("quantity_limit", 422, "Quantity limit exceeded")


class OwnershipDenied(CommerceError):
    """Use a not-found response to avoid revealing another session's records."""

    def __init__(self, resource: str = "resource") -> None:
        super().__init__(f"{resource}_not_found", 404, f"{resource.capitalize()} not found")


class CartItemNotFound(OwnershipDenied):
    def __init__(self) -> None:
        super().__init__("item")


class PaymentNotRefundable(CommerceError):
    """No captured money is refundable here: nothing was charged, or it is already back.

    A business refusal, not a failure: the caller must not retry the same request.
    """

    def __init__(self) -> None:
        super().__init__("payment_not_refundable", 409, "This payment cannot be refunded")


class RefundsUnavailable(CommerceError):
    """The refund channel is switched off; this payment's money is still refundable.

    The money stays owed and stays ``refund_pending`` for a later pass, so this must not
    borrow ``payment_not_refundable``: that code tells the customer the money will never
    come back, which would be false.
    """

    def __init__(self) -> None:
        super().__init__(
            "refunds_unavailable",
            409,
            "Refunds are not available right now. Please try again later.",
        )


class RefundFailed(CommerceError):
    """Stripe did not complete the refund. The money stays marked as owed back.

    Deliberately not a 5xx: the customer must read a stable business code instead of the
    Next proxy's ``backend_unavailable``, and the compensation pass keeps the retry. The
    refund path reports this refusal instead of raising it, so the failure record it writes
    is committed by the transaction that owns it.
    """

    def __init__(self) -> None:
        super().__init__("refund_failed", 409, "The refund could not be completed")


class OrderNotCancellable(CommerceError):
    """A settled order cannot be cancelled; its money leaves through the refund path."""

    def __init__(self) -> None:
        super().__init__("order_not_cancellable", 409, "This order can no longer be cancelled")
