"""
validation_service.py
Independent arithmetic validation for SplitMate AI bill extraction.

Principles:
  - All arithmetic uses INTEGER PAISE to avoid floating-point errors.
  - This service NEVER modifies the AI's extracted values.
  - Every discrepancy is surfaced as a ValidationWarning.
  - The caller decides what to do with the warnings.
"""

from __future__ import annotations

import logging
import math
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

logger = logging.getLogger(__name__)

# Tolerance for subtotal/total comparisons (paise).
# 50 paise = ₹0.50 covers common bill rounding (e.g. rupee rounding on GST).
MISMATCH_TOLERANCE_PAISE: int = 50


# ─────────────────────────────────────────────────────────────────────────────
# Pure arithmetic helpers
# ─────────────────────────────────────────────────────────────────────────────

def rupees_to_paise(rupees: float) -> int:
    return int(
        (Decimal(str(rupees)) * 100).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )

def apply_rate(paise: int, rate: float) -> int:
    return round(paise * rate)

def compute_subtotal(item_line_totals: List[int]) -> int:
    """Sum all item line totals in paise."""
    return sum(item_line_totals)

def compute_grand_total(
    subtotal_paise: int,
    gst_paise: int,
    service_charge_paise: int,
    discount_paise: int,
    other_charges_paise: int = 0,
    round_off_paise: int = 0,
) -> int:
    return (
        subtotal_paise
        + gst_paise
        + service_charge_paise
        + other_charges_paise
        + round_off_paise
        - discount_paise
    )


def _currency_symbol(currency: str) -> str:
    return {
        "INR": "₹",
        "USD": "$",
        "EUR": "€",
        "GBP": "£",
    }.get(currency.upper(), f"{currency.upper()} ")


def _format_money(paise: int, currency: str) -> str:
    return f"{_currency_symbol(currency)}{paise / 100:.2f}"


# ─────────────────────────────────────────────────────────────────────────────
# ValidationWarning dataclass (plain — no Pydantic dependency here)
# ─────────────────────────────────────────────────────────────────────────────

class ValidationWarning:
    """Encapsulates one arithmetic discrepancy found during validation."""

    def __init__(
        self,
        code: str,
        message: str,
        expected_paise: Optional[int] = None,
        actual_paise: Optional[int] = None,
    ) -> None:
        self.code = code
        self.message = message
        self.expected_paise = expected_paise
        self.actual_paise = actual_paise
        self.difference_paise: Optional[int] = (
            (actual_paise - expected_paise)
            if (actual_paise is not None and expected_paise is not None)
            else None
        )

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "expected_paise": self.expected_paise,
            "actual_paise": self.actual_paise,
            "difference_paise": self.difference_paise,
        }

    def __repr__(self) -> str:
        return f"ValidationWarning({self.code!r}: {self.message!r})"


# ─────────────────────────────────────────────────────────────────────────────
# Item-level validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_item_totals(
    items: list[dict],
    currency: str = "INR",
) -> List[ValidationWarning]:
    """
    For every item, verify that qty × unit_price_paise == line_total_paise.
    Returns one warning per discrepant item.
    """
    warnings: List[ValidationWarning] = []

    for item in items:
        expected = int(
            (Decimal(str(item["qty"])) * item["unit_price_paise"]).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        actual   = item["line_total_paise"]
        tolerance = max(1, math.ceil(item["qty"])) if item.get("unit_price_inferred") else 1
        if abs(expected - actual) > tolerance:
            warnings.append(ValidationWarning(
                code="ITEM_TOTAL_MISMATCH",
                message=(
                    f"Item '{item['name']}': "
                    f"{item['qty']} × {_format_money(item['unit_price_paise'], currency)} "
                    f"= {_format_money(expected, currency)} "
                    f"but bill shows {_format_money(actual, currency)}."
                ),
                expected_paise=expected,
                actual_paise=actual,
            ))

    return warnings


# ─────────────────────────────────────────────────────────────────────────────
# Bill-level validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_subtotal(
    computed_subtotal_paise: int,
    detected_subtotal_paise: Optional[int],
    currency: str = "INR",
) -> List[ValidationWarning]:
    """
    Compare the sum of item line totals against the printed subtotal.
    Returns a warning when the difference exceeds MISMATCH_TOLERANCE_PAISE.
    """
    if detected_subtotal_paise is None:
        return []

    diff = abs(computed_subtotal_paise - detected_subtotal_paise)
    if diff <= MISMATCH_TOLERANCE_PAISE:
        return []

    direction = "over" if computed_subtotal_paise > detected_subtotal_paise else "under"
    return [ValidationWarning(
        code="SUBTOTAL_MISMATCH",
        message=(
            f"Computed subtotal ({_format_money(computed_subtotal_paise, currency)}) is "
            f"{_format_money(diff, currency)} {direction} the printed subtotal "
            f"({_format_money(detected_subtotal_paise, currency)}). "
            "Review and edit items if needed."
        ),
        expected_paise=detected_subtotal_paise,
        actual_paise=computed_subtotal_paise,
    )]


def validate_grand_total(
    computed_grand_total_paise: int,
    detected_grand_total_paise: Optional[int],
    currency: str = "INR",
    subtotal_source: str = "computed items subtotal",
) -> List[ValidationWarning]:
    """
    Compare the calculated grand total against the printed grand total.
    """
    if detected_grand_total_paise is None:
        return []

    diff = abs(computed_grand_total_paise - detected_grand_total_paise)
    if diff <= MISMATCH_TOLERANCE_PAISE:
        return []

    direction = "over" if computed_grand_total_paise > detected_grand_total_paise else "under"
    return [ValidationWarning(
        code="GRAND_TOTAL_MISMATCH",
        message=(
            f"Grand total using {subtotal_source} "
            f"({_format_money(computed_grand_total_paise, currency)}) is "
            f"{_format_money(diff, currency)} {direction} the printed grand total "
            f"({_format_money(detected_grand_total_paise, currency)})."
        ),
        expected_paise=detected_grand_total_paise,
        actual_paise=computed_grand_total_paise,
    )]


# ─────────────────────────────────────────────────────────────────────────────
# Full bill validation (orchestrator)
# ─────────────────────────────────────────────────────────────────────────────

class BillValidationResult:
    """Aggregated outcome of all validation checks for one bill."""

    def __init__(self) -> None:
        self.warnings: List[ValidationWarning] = []
        self.computed_subtotal_paise: int = 0
        self.computed_grand_total_paise: int = 0

    @property
    def has_mismatch(self) -> bool:
        return len(self.warnings) > 0

    def warning_dicts(self) -> list[dict]:
        return [w.to_dict() for w in self.warnings]


def validate_bill(
    items: list[dict],
    detected_subtotal_paise: Optional[int],
    detected_gst_paise: Optional[int],
    detected_discount_paise: Optional[int],
    detected_service_charge_paise: Optional[int],
    detected_grand_total_paise: Optional[int],
    detected_other_charges_paise: Optional[int] = None,
    detected_round_off_paise: Optional[int] = None,
    currency: str = "INR",
) -> BillValidationResult:
    """
    Run all validation checks:
      1. qty × unit_price agrees with line_total for every item
      2. sum(line_totals) == printed subtotal
      3. computed and detected subtotals agree with printed grand total

    Never modifies the input values.
    Returns a BillValidationResult with all warnings and computed totals.
    """
    result = BillValidationResult()

    # 1. Item-level checks
    item_warnings = validate_item_totals(items, currency)
    result.warnings.extend(item_warnings)

    # 2. Computed subtotal
    line_totals = [item["line_total_paise"] for item in items]
    computed_sub = compute_subtotal(line_totals)
    result.computed_subtotal_paise = computed_sub

    sub_warnings = validate_subtotal(computed_sub, detected_subtotal_paise, currency)
    result.warnings.extend(sub_warnings)

    # 3. Compare the printed total against both possible subtotal sources.
    gst = detected_gst_paise or 0
    service = detected_service_charge_paise or 0
    discount = detected_discount_paise or 0
    other_charges = detected_other_charges_paise or 0
    round_off = detected_round_off_paise or 0
    computed_total = compute_grand_total(
        computed_sub, gst, service, discount, other_charges, round_off
    )
    result.computed_grand_total_paise = computed_total
    result.warnings.extend(
        validate_grand_total(
            computed_total,
            detected_grand_total_paise,
            currency,
            "computed items subtotal",
        )
    )

    if detected_subtotal_paise is not None and detected_subtotal_paise != computed_sub:
        detected_subtotal_total = compute_grand_total(
            detected_subtotal_paise,
            gst,
            service,
            discount,
            other_charges,
            round_off,
        )
        detected_total_warnings = validate_grand_total(
            detected_subtotal_total,
            detected_grand_total_paise,
            currency,
            "detected subtotal",
        )
        for warning in detected_total_warnings:
            warning.code = "GRAND_TOTAL_MISMATCH_DETECTED_SUBTOTAL"
        result.warnings.extend(detected_total_warnings)

    if result.has_mismatch:
        logger.warning(
            "Bill validation: %d warning(s): %s",
            len(result.warnings),
            [w.code for w in result.warnings],
        )
    else:
        logger.info("Bill validation passed — no mismatches.")

    return result
