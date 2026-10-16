from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal

SUPPORTED_CURRENCIES: dict[str, int] = {"USD": 2}
MINIMUM_CHARGE_MINOR: dict[str, int] = {"USD": 50}


def to_minor_units(amount: Decimal, currency: str) -> int:
    """Convert a decimal amount into Stripe's integer minor units.

    The value must be exactly representable in the currency's minor unit: the quantized
    result is compared against the exact scaled value, so sub-cent precision raises
    instead of silently changing the amount being charged.
    """
    if currency not in SUPPORTED_CURRENCIES:
        raise ValueError(f"unsupported currency: {currency}")
    if amount < 0:
        raise ValueError(f"amount must not be negative: {amount}")
    exact = amount.scaleb(SUPPORTED_CURRENCIES[currency])
    quantized = exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if quantized != exact:
        raise ValueError(f"amount has more precision than {currency} supports: {amount}")
    return int(quantized)


def is_chargeable(amount: Decimal, currency: str) -> bool:
    """Whether Stripe can charge this amount, i.e. it meets the currency minimum."""
    return to_minor_units(amount, currency) >= MINIMUM_CHARGE_MINOR[currency]


def order_total_from_items(items: Sequence[tuple[Decimal, int]]) -> Decimal:
    """Sum ``unit_price * quantity`` over order lines using Decimal only."""
    total = Decimal("0.00")
    for unit_price, quantity in items:
        total += unit_price * quantity
    return total
