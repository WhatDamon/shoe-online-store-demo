from typing import Literal

ORDER_STATUSES: tuple[str, ...] = ("pending_payment", "paid", "cancelled", "refunded")
PAYMENT_STATUSES: tuple[str, ...] = (
    "disabled",
    "requires_payment",
    "succeeded",
    "refund_pending",
    "refunded",
)
RESERVATION_STATUSES: tuple[str, ...] = ("active", "consumed", "released")

OrderStatus = Literal["pending_payment", "paid", "cancelled", "refunded"]
PaymentStatus = Literal["disabled", "requires_payment", "succeeded", "refund_pending", "refunded"]
ReservationStatus = Literal["active", "consumed", "released"]


def sql_in(column: str, allowed: tuple[str, ...]) -> str:
    values = ", ".join(f"'{value}'" for value in allowed)
    return f"{column} IN ({values})"
