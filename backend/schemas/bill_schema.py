"""
bill_schema.py
Pydantic models for SplitMate AI bill extraction payloads.

MONETARY CONVENTION
───────────────────
All prices are stored and transported as INTEGER PAISE.
  1 Indian Rupee (INR) = 100 paise
The frontend converts paise ↔ rupee-floats at render time.
The backend never stores rupee floats internally.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


# ── Enums ─────────────────────────────────────────────────────────────────────

class CurrencyCode(str, Enum):
    INR = "INR"
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    UNKNOWN = "UNKNOWN"


# ─────────────────────────────────────────────────────────────────────────────
# Raw provider output schema
# Monetary values remain in major currency units here; the service layer
# converts them to integer paise before building the API response.
# ─────────────────────────────────────────────────────────────────────────────

class RawItemSchema(BaseModel):
    """One line item as returned by Gemini (amounts in rupees, may be null)."""

    name: str
    qty: float = Field(default=1.0, gt=0)
    unit_price: Optional[float] = None   # rupees
    item_total: Optional[float] = None   # rupees
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)

    @field_validator("unit_price", "item_total", mode="before")
    @classmethod
    def _parse_amount(cls, value):
        return parse_currency_amount(value)


class RawOCRBill(BaseModel):
    """
    Provider-neutral structured bill output.
    All monetary values are in the detected currency (rupees for INR bills).
    Unknown/unreadable fields must be null; providers must not invent values.
    """

    restaurant_name: Optional[str] = None
    items: List[RawItemSchema] = Field(default_factory=list)
    subtotal: Optional[float] = None           # printed subtotal
    gst_amount: Optional[float] = None         # printed GST / tax
    discount_amount: Optional[float] = None    # any discount line
    service_charge: Optional[float] = None     # service charge / tip on bill
    other_charges: Optional[float] = None      # packaging, delivery, etc.
    round_off: Optional[float] = None
    grand_total: Optional[float] = None        # printed grand total
    currency: str = "UNKNOWN"
    overall_confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    warnings: List[str] = Field(default_factory=list)

    @field_validator(
        "subtotal",
        "gst_amount",
        "discount_amount",
        "service_charge",
        "other_charges",
        "round_off",
        "grand_total",
        mode="before",
    )
    @classmethod
    def _parse_amounts(cls, value):
        return parse_currency_amount(value)


RawGeminiOutput = RawOCRBill


def parse_currency_amount(value: object) -> Optional[float]:
    """Parse numeric JSON amounts and common printed Indian currency formats."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        cleaned = re.sub(r"(?i)^(?:rs\.?|inr)\s*", "", cleaned)
        cleaned = cleaned.replace(",", "")
        for symbol in ("₹", "$", "€", "£"):
            cleaned = cleaned.replace(symbol, "")
        value = cleaned.strip()
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return amount if amount == amount and abs(amount) != float("inf") else None

# ─────────────────────────────────────────────────────────────────────────────
# API-level schemas (paise, used in the HTTP response)
# ─────────────────────────────────────────────────────────────────────────────

class ExtractedItemSchema(BaseModel):
    """A single line item in the OCR API response — amounts in integer paise."""

    id: str = Field(..., description="Unique identifier for this item")
    name: str = Field(..., min_length=1)
    qty: float = Field(..., gt=0)
    unit_price_paise: int = Field(..., ge=0, description="Unit price in integer paise")
    line_total_paise: int = Field(..., ge=0, description="Printed or computed line total in paise")
    unit_price_inferred: bool = Field(
        default=False,
        description="True when unit price was inferred from the printed line total.",
    )
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ValidationWarning(BaseModel):
    """A single validation warning produced by the validation service."""

    code: str = Field(..., description="Machine-readable warning code")
    message: str = Field(..., description="Human-readable explanation")
    expected_paise: Optional[int] = None
    actual_paise: Optional[int] = None
    difference_paise: Optional[int] = None


class OCRTextRegion(BaseModel):
    text: str
    confidence: Optional[float] = None
    bbox: List[List[int]] = Field(default_factory=list)


class OCRExtractResponse(BaseModel):
    """Full response returned by POST /api/ocr/extract."""

    success: bool
    is_demo_data: bool = Field(
        default=False,
        description="Always False for real OCR results.",
    )

    # Bill metadata
    restaurant_name: Optional[str] = None
    detected_currency: CurrencyCode = Field(default=CurrencyCode.INR)
    currency_mismatch: bool = Field(
        default=False,
        description="True when detected_currency differs from the hint.",
    )

    # Items
    items: List[ExtractedItemSchema] = Field(default_factory=list)

    # Printed amounts (from the bill image, in paise)
    detected_subtotal_paise: Optional[int] = None
    detected_gst_paise: Optional[int] = None
    detected_discount_paise: Optional[int] = None
    detected_service_charge_paise: Optional[int] = None
    detected_other_charges_paise: Optional[int] = None
    detected_round_off_paise: Optional[int] = None
    detected_grand_total_paise: Optional[int] = None

    # Computed amounts (from summing items, in paise)
    computed_subtotal_paise: int = Field(default=0)
    computed_grand_total_paise: int = Field(default=0)

    # Validation
    validation_warnings: List[ValidationWarning] = Field(default_factory=list)
    has_mismatch: bool = Field(default=False)

    # Overall quality
    ocr_provider: str = "gemini"
    ocr_text: Optional[str] = None
    ocr_regions: List[OCRTextRegion] = Field(default_factory=list)
    overall_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    provider_warnings: List[str] = Field(default_factory=list)
    gemini_warnings: List[str] = Field(default_factory=list)

    # Human-readable summary
    message: str = Field(default="")


# ── OCR request metadata ──────────────────────────────────────────────────────

class OCRExtractRequest(BaseModel):
    hint_currency: CurrencyCode = Field(
        default=CurrencyCode.INR,
        description="Currency the user expects on the bill.",
    )


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    app: str
