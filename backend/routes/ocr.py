"""
routes/ocr.py
OCR extraction endpoint for SplitMate AI.

POST /api/ocr/extract
─────────────────────
Accepts a multipart form upload (image + optional currency hint).
Calls the configured OCR provider, validates the response, and returns structured bill data.
All amounts in the response are integer paise.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError

from schemas.bill_schema import (
    CurrencyCode,
    ExtractedItemSchema,
    OCRExtractResponse,
    ValidationWarning as SchemaValidationWarning,
)
from services import gemini_service
from services import paddleocr_service
from services.ocr_provider import get_ocr_provider
from services.validation_service import rupees_to_paise, validate_bill

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ocr", tags=["OCR"])

_ALLOWED_MIME: set[str] = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
_MAX_BYTES: int = 10 * 1024 * 1024   # 10 MB
_GEMINI_DEADLINE_SEC: float = 100.0


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/extract",
    response_model=OCRExtractResponse,
    summary="Extract bill items from an image",
    description=(
        "Upload a photo of a restaurant bill (JPEG, PNG, or WebP, max 10 MB). "
        "The configured OCR provider extracts line items, taxes, and totals. "
        "All monetary values in the response are **integer paise** (₹1 = 100 paise)."
    ),
    responses={
        200: {"description": "Bill extracted successfully"},
        400: {"description": "Invalid file type, empty file, or oversized upload"},
        422: {"description": "OCR output failed schema validation"},
        503: {"description": "Selected OCR provider is not installed or unavailable"},
        502: {"description": "The selected OCR provider returned an upstream error"},
    },
)
async def extract_bill(
    file: UploadFile = File(..., description="JPEG, PNG, or WebP image of the bill"),
    hint_currency: CurrencyCode = Form(
        default=CurrencyCode.INR,
        description="Currency the user expects. OCR may detect differently.",
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

    # ── 2. Resolve the configured OCR provider ───────────────────────────────
    try:
        provider = get_ocr_provider()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    if provider == "gemini" and not gemini_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Gemini API key is not configured. "
                "Set GEMINI_API_KEY in backend/.env and restart the server."
            ),
        )

    # ── 3. Call the selected provider ────────────────────────────────────────
    paddle_result: Optional[paddleocr_service.PaddleOCRExtraction] = None
    try:
        if provider == "gemini":
            raw = await asyncio.wait_for(
                gemini_service.extract_bill_items(image_bytes, content_type),
                timeout=_GEMINI_DEADLINE_SEC,
            )
        else:
            paddle_result = await asyncio.wait_for(
                paddleocr_service.extract_bill_items(image_bytes),
                timeout=_GEMINI_DEADLINE_SEC,
            )
            raw = paddle_result.bill
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OCR exceeded the 100-second processing deadline. Please retry.",
        )
    except paddleocr_service.PaddleOCRUnavailableError as exc:
        logger.error("Selected PaddleOCR provider is unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except paddleocr_service.PaddleOCRProcessingError as exc:
        logger.warning("PaddleOCR could not process the uploaded image: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except gemini_service.GeminiOutputError as exc:
        logger.warning("Gemini returned unusable output (%s): %s", exc.code, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except ValueError as exc:
        logger.warning("%s OCR output could not be parsed: %s", provider, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except gemini_service.GeminiAPIError as exc:
        code = exc.status_code
        if code in {408, 429, 503, 504} or (code is not None and 500 <= code <= 599):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Gemini Vision is temporarily unavailable (upstream status {code}). Please retry.",
            ) from exc
        if code == 400:
            detail = "Gemini rejected the OCR request as invalid. Check the configured model and request format."
        elif code == 401:
            detail = "Gemini authentication failed. Verify the backend API key configuration."
        elif code == 403:
            detail = "Gemini denied access. Check API permissions, billing, and model availability."
        elif code == 404:
            detail = "The configured Gemini model was not found. Check GEMINI_MODEL."
        else:
            detail = f"Gemini returned an upstream error (status {code or 'unknown'})."
        logger.error("Gemini API error (status=%s): %s", code, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc
    except Exception as exc:
        logger.error("Unexpected %s OCR service error: %s", provider, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The {provider} OCR provider returned an unexpected processing error.",
        ) from exc

    # ── 4. Build extracted items (convert raw floats → paise) ─────────────────
    item_dicts = gemini_service.build_extracted_items(raw)

    # Keep every generated item in the response, using a safe placeholder only
    # if an item cannot be represented by the public response schema.
    validated_items: list[ExtractedItemSchema] = []
    item_schema_warnings: list[str] = []

    item_warnings: list[str] = []
    for index, d in enumerate(item_dicts, start=1):
        item_warnings.extend(d.get("gemini_warnings", []))
        clean_item = {key: value for key, value in d.items() if key != "gemini_warnings"}
        try:
            validated_items.append(ExtractedItemSchema(**clean_item))
        except (ValidationError, TypeError, ValueError) as exc:
            item_schema_warnings.append(
                f"Item {index} could not be represented exactly and was retained with safe values: {exc}"
            )
            fallback = {
                "id": str(clean_item.get("id") or f"ocr_unreadable_{index}"),
                "name": str(clean_item.get("name") or f"Unreadable item {index}").strip()
                or f"Unreadable item {index}",
                "qty": clean_item.get("qty", 1.0),
                "unit_price_paise": clean_item.get("unit_price_paise", 0),
                "line_total_paise": clean_item.get("line_total_paise", 0),
                "unit_price_inferred": bool(clean_item.get("unit_price_inferred", False)),
                "confidence": 0.3,
            }
            try:
                validated_items.append(ExtractedItemSchema(**fallback))
            except (ValidationError, TypeError, ValueError):
                validated_items.append(
                    ExtractedItemSchema(
                        id=f"ocr_unreadable_{index}",
                        name=f"Unreadable item {index}",
                        qty=1.0,
                        unit_price_paise=0,
                        line_total_paise=0,
                        confidence=0.0,
                    )
                )

    # ── 5. Convert bill-level amounts to paise ────────────────────────────────
    detected_subtotal_paise  = _to_paise(raw.subtotal)
    detected_gst_paise       = _to_paise(raw.gst_amount, absolute=True)
    detected_discount_paise  = _to_paise(raw.discount_amount, absolute=True)
    detected_service_paise   = _to_paise(raw.service_charge, absolute=True)
    detected_other_charges_paise = _to_paise(raw.other_charges)
    detected_round_off_paise = _to_paise(raw.round_off)
    detected_grand_paise     = _to_paise(raw.grand_total)

    # ── 6. Validate arithmetic ────────────────────────────────────────────────
    detected_currency_str = (raw.currency or "UNKNOWN").upper()
    try:
        detected_currency = CurrencyCode(detected_currency_str)
    except ValueError:
        detected_currency = CurrencyCode.UNKNOWN

    validation_items = [item.model_dump() for item in validated_items]
    validation = validate_bill(
        items=validation_items,
        detected_subtotal_paise=detected_subtotal_paise,
        detected_gst_paise=detected_gst_paise,
        detected_discount_paise=detected_discount_paise,
        detected_service_charge_paise=detected_service_paise,
        detected_grand_total_paise=detected_grand_paise,
        detected_other_charges_paise=detected_other_charges_paise,
        detected_round_off_paise=detected_round_off_paise,
        currency=detected_currency.value,
    )

    # Map validation warnings to schema model
    schema_warnings = [
        SchemaValidationWarning(**w) for w in validation.warning_dicts()
    ]

    # ── 7. Currency mismatch flag ─────────────────────────────────────────────
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
    all_warnings = list(dict.fromkeys(
        raw.warnings + item_warnings + item_schema_warnings
    ))

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
        ocr_provider=provider,
        ocr_text=paddle_result.text if paddle_result else None,
        ocr_regions=paddle_result.regions if paddle_result else [],
        restaurant_name=raw.restaurant_name,
        detected_currency=detected_currency,
        currency_mismatch=currency_mismatch,
        items=validated_items,
        detected_subtotal_paise=detected_subtotal_paise,
        detected_gst_paise=detected_gst_paise,
        detected_discount_paise=detected_discount_paise,
        detected_service_charge_paise=detected_service_paise,
        detected_other_charges_paise=detected_other_charges_paise,
        detected_round_off_paise=detected_round_off_paise,
        detected_grand_total_paise=detected_grand_paise,
        computed_subtotal_paise=validation.computed_subtotal_paise,
        computed_grand_total_paise=validation.computed_grand_total_paise,
        validation_warnings=schema_warnings,
        has_mismatch=validation.has_mismatch,
        overall_confidence=raw.overall_confidence,
        provider_warnings=all_warnings,
        gemini_warnings=all_warnings,
        message=" ".join(message_parts),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper
# ─────────────────────────────────────────────────────────────────────────────

def _to_paise(
    rupees: Optional[float],
    *,
    absolute: bool = False,
) -> Optional[int]:
    """None-safe rupee float → integer paise."""
    if rupees is None:
        return None
    amount = abs(rupees) if absolute else rupees
    return rupees_to_paise(amount)
