"""
routes/ocr.py
OCR extraction endpoint for SplitMate AI.

POST /api/ocr/extract
─────────────────────
Accepts a multipart form upload (image + optional currency hint).
Calls Gemini Vision, validates the response, and returns structured bill data.
All amounts in the response are integer paise.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from schemas.bill_schema import (
    CurrencyCode,
    ExtractedItemSchema,
    OCRExtractResponse,
    ValidationWarning as SchemaValidationWarning,
)
from services import gemini_service
from services.validation_service import validate_bill, rupees_to_paise

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ocr", tags=["OCR"])

_ALLOWED_MIME: set[str] = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
_MAX_BYTES: int = 10 * 1024 * 1024   # 10 MB


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/extract",
    response_model=OCRExtractResponse,
    summary="Extract bill items from an image",
    description=(
        "Upload a photo of a restaurant bill (JPEG, PNG, or WebP, max 10 MB). "
        "Gemini Vision extracts line items, taxes, and totals. "
        "All monetary values in the response are **integer paise** (₹1 = 100 paise)."
    ),
    responses={
        200: {"description": "Bill extracted successfully"},
        400: {"description": "Invalid file type, empty file, or oversized upload"},
        422: {"description": "Gemini returned output that failed schema validation"},
        503: {"description": "Gemini API key missing or service unavailable"},
    },
)
async def extract_bill(
    file: UploadFile = File(..., description="JPEG, PNG, or WebP image of the bill"),
    hint_currency: CurrencyCode = Form(
        default=CurrencyCode.INR,
        description="Currency the user expects. Gemini may detect differently.",
    ),
) -> OCRExtractResponse:
    # ── 1. Validate upload ────────────────────────────────────────────────────
    content_type = (file.content_type or "").lower()
    logger.info("[OCR] content_type from multipart part: %r (allowed: %s)", content_type, sorted(_ALLOWED_MIME))
    if content_type not in _ALLOWED_MIME:
        logger.warning("[OCR] Rejected: unsupported content_type=%r", content_type)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported file type '{content_type}'. "
                "Upload a JPEG, PNG, or WebP image."
            ),
        )

    image_bytes = await file.read()

    if len(image_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"File too large ({len(image_bytes):,} bytes). "
                "Maximum allowed size is 10 MB."
            ),
        )

    logger.info(
        "[OCR] Request received: filename=%r content_type=%r size=%d bytes hint_currency=%s",
        file.filename,
        content_type,
        len(image_bytes),
        hint_currency.value,
    )

    # ── 2. Check Gemini is configured ─────────────────────────────────────────
    if not gemini_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Gemini API key is not configured. "
                "Set GEMINI_API_KEY in backend/.env and restart the server."
            ),
        )

    # ── 3. Call Gemini Vision ─────────────────────────────────────────────────
    try:
        raw = await gemini_service.extract_bill_items(image_bytes, content_type)
    except ValueError as exc:
        # JSON parse failure or empty response
        logger.warning("Gemini parse error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except Exception as exc:
        # Gemini API error (quota, auth, server error, etc.)
        logger.error("Gemini API error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Gemini Vision service error: {exc}. "
                "Check your API key and quota, then retry."
            ),
        )

    # ── 4. Build extracted items (convert raw floats → paise) ─────────────────
    item_dicts = gemini_service.build_extracted_items(raw)

    # Validate each item dict before constructing Pydantic models
    validated_items: list[ExtractedItemSchema] = []
    item_schema_warnings: list[str] = []

    for d in item_dicts:
        try:
            validated_items.append(ExtractedItemSchema(**d))
        except Exception as exc:
            item_schema_warnings.append(
                f"Item '{d.get('name', '?')}' failed validation and was skipped: {exc}"
            )
            logger.warning("Item schema error: %s", exc)

    # ── 5. Convert bill-level amounts to paise ────────────────────────────────
    detected_subtotal_paise  = _to_paise(raw.subtotal)
    detected_gst_paise       = _to_paise(raw.gst_amount)
    detected_discount_paise  = _to_paise(raw.discount_amount)
    detected_service_paise   = _to_paise(raw.service_charge)
    detected_grand_paise     = _to_paise(raw.grand_total)

    # ── 6. Validate arithmetic ────────────────────────────────────────────────
    validation = validate_bill(
        items=item_dicts,
        detected_subtotal_paise=detected_subtotal_paise,
        detected_gst_paise=detected_gst_paise,
        detected_discount_paise=detected_discount_paise,
        detected_service_charge_paise=detected_service_paise,
        detected_grand_total_paise=detected_grand_paise,
    )

    # Map validation warnings to schema model
    schema_warnings = [
        SchemaValidationWarning(**w) for w in validation.warning_dicts()
    ]

    # ── 7. Currency mismatch flag ─────────────────────────────────────────────
    detected_currency_str = (raw.currency or "UNKNOWN").upper()
    try:
        detected_currency = CurrencyCode(detected_currency_str)
    except ValueError:
        detected_currency = CurrencyCode.UNKNOWN

    currency_mismatch = (
        detected_currency != CurrencyCode.UNKNOWN
        and detected_currency != hint_currency
    )
    if currency_mismatch:
        logger.info(
            "Currency mismatch: hint=%s detected=%s",
            hint_currency.value,
            detected_currency.value,
        )

    # ── 8. Compose response ───────────────────────────────────────────────────
    total_items = len(validated_items)
    all_warnings = raw.warnings + item_schema_warnings

    message_parts = [f"{total_items} item(s) extracted."]
    if validation.has_mismatch:
        message_parts.append(f"{len(schema_warnings)} validation warning(s).")
    if currency_mismatch:
        message_parts.append(
            f"Bill currency ({detected_currency.value}) differs from hint "
            f"({hint_currency.value}) — no automatic conversion applied."
        )

    logger.info(
        "[OCR] Returning success: %d items, mismatch=%s, confidence=%.2f",
        len(validated_items),
        validation.has_mismatch,
        raw.overall_confidence,
    )
    return OCRExtractResponse(
        success=True,
        is_demo_data=False,
        restaurant_name=raw.restaurant_name,
        detected_currency=detected_currency,
        currency_mismatch=currency_mismatch,
        items=validated_items,
        detected_subtotal_paise=detected_subtotal_paise,
        detected_gst_paise=detected_gst_paise,
        detected_discount_paise=detected_discount_paise,
        detected_service_charge_paise=detected_service_paise,
        detected_grand_total_paise=detected_grand_paise,
        computed_subtotal_paise=validation.computed_subtotal_paise,
        computed_grand_total_paise=validation.computed_grand_total_paise,
        validation_warnings=schema_warnings,
        has_mismatch=validation.has_mismatch,
        overall_confidence=raw.overall_confidence,
        gemini_warnings=all_warnings,
        message=" ".join(message_parts),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper
# ─────────────────────────────────────────────────────────────────────────────

def _to_paise(rupees: Optional[float]) -> Optional[int]:
    """None-safe rupee float → integer paise."""
    if rupees is None:
        return None
    return round(rupees * 100)
