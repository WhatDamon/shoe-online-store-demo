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
