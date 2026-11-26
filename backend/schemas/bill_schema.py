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

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Enums ─────────────────────────────────────────────────────────────────────

class CurrencyCode(str, Enum):
    INR = "INR"
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    UNKNOWN = "UNKNOWN"


# ─────────────────────────────────────────────────────────────────────────────
# Raw Gemini output schema
# These mirror the JSON structure Gemini is asked to return.
# They use Optional floats because Gemini works in rupees; the service
# layer converts them to paise before building the API response.
# ─────────────────────────────────────────────────────────────────────────────

class RawItemSchema(BaseModel):
    """One line item as returned by Gemini (amounts in rupees, may be null)."""

    name: str
    qty: float = Field(default=1.0)
    unit_price: Optional[float] = None   # rupees
    item_total: Optional[float] = None   # rupees
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class RawGeminiOutput(BaseModel):
    """
    Full structured JSON that Gemini is instructed to return.
    All monetary values are in the detected currency (rupees for INR bills).
    Unknown/unreadable fields must be null — Gemini must NOT invent values.
    """

    restaurant_name: Optional[str] = None
    items: List[RawItemSchema] = Field(default_factory=list)
    subtotal: Optional[float] = None           # printed subtotal
    gst_amount: Optional[float] = None         # printed GST / tax
    discount_amount: Optional[float] = None    # any discount line
    service_charge: Optional[float] = None     # service charge / tip on bill
    grand_total: Optional[float] = None        # printed grand total
    currency: str = "UNKNOWN"
    overall_confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    warnings: List[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# API-level schemas (paise, used in the HTTP response)
# ─────────────────────────────────────────────────────────────────────────────

class ExtractedItemSchema(BaseModel):
    """A single line item in the OCR API response — amounts in integer paise."""

    id: str = Field(..., description="Unique identifier for this item")
    name: str = Field(..., min_length=1)
    qty: int = Field(..., ge=1)
    unit_price_paise: int = Field(..., ge=0, description="Unit price in integer paise")
    line_total_paise: int = Field(..., ge=0, description="qty × unit_price_paise")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    @field_validator("line_total_paise")
    @classmethod
    def _check_line_total(cls, v: int, info) -> int:
        data = info.data
        expected = data.get("qty", 1) * data.get("unit_price_paise", 0)
        if expected != v:
            raise ValueError(
                f"line_total_paise ({v}) ≠ qty ({data.get('qty')}) "
                f"× unit_price_paise ({data.get('unit_price_paise')})"
            )
        return v


class ValidationWarning(BaseModel):
    """A single validation warning produced by the validation service."""

    code: str = Field(..., description="Machine-readable warning code")
    message: str = Field(..., description="Human-readable explanation")
    expected_paise: Optional[int] = None
    actual_paise: Optional[int] = None
    difference_paise: Optional[int] = None


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
    detected_grand_total_paise: Optional[int] = None

    # Computed amounts (from summing items, in paise)
    computed_subtotal_paise: int = Field(default=0)
    computed_grand_total_paise: int = Field(default=0)

    # Validation
    validation_warnings: List[ValidationWarning] = Field(default_factory=list)
    has_mismatch: bool = Field(default=False)

    # Overall quality
    overall_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
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
