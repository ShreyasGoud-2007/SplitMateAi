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
from typing import List, Optional

logger = logging.getLogger(__name__)

# Tolerance for subtotal/total comparisons (paise).
# 50 paise = ₹0.50 covers common bill rounding (e.g. rupee rounding on GST).
MISMATCH_TOLERANCE_PAISE: int = 50


# ─────────────────────────────────────────────────────────────────────────────
# Pure arithmetic helpers
# ─────────────────────────────────────────────────────────────────────────────

def rupees_to_paise(rupees: float) -> int:
    return round(rupees * 100)

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
) -> int:
    return subtotal_paise + gst_paise + service_charge_paise - discount_paise


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
    items: list[dict],  # list of dicts with keys: id, name, qty, unit_price_paise, line_total_paise
) -> List[ValidationWarning]:
    """
    For every item, verify that qty × unit_price_paise == line_total_paise.
    Returns one warning per discrepant item.
    """
    warnings: List[ValidationWarning] = []

    for item in items:
        expected = item["qty"] * item["unit_price_paise"]
        actual   = item["line_total_paise"]
        if abs(expected - actual) > 0:   # any difference at all — paise is exact
            warnings.append(ValidationWarning(
                code="ITEM_TOTAL_MISMATCH",
                message=(
                    f"Item '{item['name']}': "
                    f"{item['qty']} × ₹{item['unit_price_paise']/100:.2f} "
                    f"= ₹{expected/100:.2f} "
                    f"but bill shows ₹{actual/100:.2f}."
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
            f"Computed subtotal (₹{computed_subtotal_paise/100:.2f}) is "
            f"₹{diff/100:.2f} {direction} the printed subtotal "
            f"(₹{detected_subtotal_paise/100:.2f}). "
            "Review and edit items if needed."
        ),
        expected_paise=detected_subtotal_paise,
        actual_paise=computed_subtotal_paise,
    )]


def validate_grand_total(
    computed_grand_total_paise: int,
    detected_grand_total_paise: Optional[int],
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
            f"Calculated grand total (₹{computed_grand_total_paise/100:.2f}) is "
            f"₹{diff/100:.2f} {direction} the printed grand total "
            f"(₹{detected_grand_total_paise/100:.2f})."
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
) -> BillValidationResult:
    """
    Run all validation checks:
      1. qty × unit_price == line_total for every item
      2. sum(line_totals) == printed subtotal
      3. subtotal + gst + service_charge - discount == printed grand total

    Never modifies the input values.
    Returns a BillValidationResult with all warnings and computed totals.
    """
    result = BillValidationResult()

    # 1. Item-level checks
    item_warnings = validate_item_totals(items)
    result.warnings.extend(item_warnings)

    # 2. Computed subtotal
    line_totals = [item["line_total_paise"] for item in items]
    computed_sub = compute_subtotal(line_totals)
    result.computed_subtotal_paise = computed_sub

    sub_warnings = validate_subtotal(computed_sub, detected_subtotal_paise)
    result.warnings.extend(sub_warnings)

    # 3. Computed grand total
    # Use detected values when available; otherwise fall back to computed subtotal + 0 for unknowns.
    sub_for_total  = detected_subtotal_paise if detected_subtotal_paise is not None else computed_sub
    gst            = detected_gst_paise            or 0
    service        = detected_service_charge_paise or 0
    discount       = detected_discount_paise       or 0

    computed_total = compute_grand_total(sub_for_total, gst, service, discount)
    result.computed_grand_total_paise = computed_total

    total_warnings = validate_grand_total(computed_total, detected_grand_total_paise)
    result.warnings.extend(total_warnings)

    if result.has_mismatch:
        logger.warning(
            "Bill validation: %d warning(s): %s",
            len(result.warnings),
            [w.code for w in result.warnings],
        )
    else:
        logger.info("Bill validation passed — no mismatches.")

    return result
