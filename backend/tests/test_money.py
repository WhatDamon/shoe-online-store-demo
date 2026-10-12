from decimal import Decimal

import pytest

from app.domain.money import is_chargeable, order_total_from_items, to_minor_units


def test_to_minor_units_is_exact_for_two_decimals():
    assert to_minor_units(Decimal("98.00"), "USD") == 9800
    assert to_minor_units(Decimal("0.01"), "USD") == 1
    assert to_minor_units(Decimal("0"), "USD") == 0


def test_to_minor_units_rejects_sub_cent_precision():
    # 1.005 is exactly half a cent: ROUND_HALF_UP would carry it to 101, but a sub-cent
    # amount must raise instead of silently becoming a different amount.
    with pytest.raises(ValueError, match="precision"):
        to_minor_units(Decimal("1.005"), "USD")
    with pytest.raises(ValueError, match="precision"):
        to_minor_units(Decimal("9800.005"), "USD")
    with pytest.raises(ValueError, match="precision"):
        to_minor_units(Decimal("1.0049"), "USD")


def test_to_minor_units_rejects_unsupported_currency():
    with pytest.raises(ValueError, match="unsupported currency"):
        to_minor_units(Decimal("98.00"), "XYZ")
    with pytest.raises(ValueError, match="unsupported currency"):
        is_chargeable(Decimal("98.00"), "XYZ")


def test_to_minor_units_rejects_negative():
    with pytest.raises(ValueError, match="negative"):
        to_minor_units(Decimal("-0.01"), "USD")
    with pytest.raises(ValueError, match="negative"):
        is_chargeable(Decimal("-1.00"), "USD")


def test_is_chargeable_enforces_stripe_minimum():
    assert is_chargeable(Decimal("0.00"), "USD") is False
    assert is_chargeable(Decimal("0.49"), "USD") is False
    assert is_chargeable(Decimal("0.50"), "USD") is True
    assert is_chargeable(Decimal("98.00"), "USD") is True


def test_order_total_sums_unit_price_times_quantity():
    total = order_total_from_items(
        [
            (Decimal("0.10"), 1),
            (Decimal("0.20"), 1),
            (Decimal("98.00"), 2),
        ]
    )
    assert isinstance(total, Decimal)
    assert total == Decimal("196.30")
    assert to_minor_units(total, "USD") == 19630

    # Amounts where binary floats drift: 0.10 + 0.20 is 0.30000000000000004 and
    # 0.70 * 7 is 4.8999999999999995, so exact Decimal arithmetic is observable here.
    fractional = order_total_from_items([(Decimal("0.10"), 1), (Decimal("0.20"), 1)])
    assert fractional == Decimal("0.30")
    assert to_minor_units(fractional, "USD") == 30
    assert order_total_from_items([(Decimal("0.70"), 7)]) == Decimal("4.90")
