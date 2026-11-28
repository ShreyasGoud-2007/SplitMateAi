"""
gemini_service.py
Gemini Vision OCR integration for SplitMate AI.

Uses google-genai 3.x SDK:
    client = genai.Client(api_key=...)
    response = await client.aio.models.generate_content(
        model=..., contents=[...], config=GenerateContentConfig(...)
    )

Reliability:
    - Retries transient 408/429/5xx errors and request timeouts with exponential
      backoff, up to MAX_ATTEMPTS times.
    - Permanent client errors are NOT retried.
    - Model-not-found (404) returns a clear message explaining how to list
      supported models via the SDK.

Security notes:
    - API key is read from the environment only; never logged or returned.
    - Uploaded image bytes are held in memory only for the duration of the
      request and never written to disk. Image contents are never logged.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

logger = logging.getLogger(__name__)

# ── SDK import ────────────────────────────────────────────────────────────────

try:
    import google.genai as genai
    from google.genai import types as genai_types
    from google.genai import errors as genai_errors
    _GENAI_AVAILABLE = True
except ImportError:
    _GENAI_AVAILABLE = False
    logger.warning("google-genai package not installed — Gemini OCR unavailable.")

# ── Local imports ─────────────────────────────────────────────────────────────
from schemas.bill_schema import RawGeminiOutput, RawItemSchema, parse_currency_amount
from services.validation_service import rupees_to_paise


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

def _api_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY")

def _model_name() -> str:
    """
    Read the Gemini model name from the environment.
    Raises RuntimeError if GEMINI_MODEL is not set — no hardcoded fallback,
    since a wrong default could silently use a deprecated model.
    """
    model = os.getenv("GEMINI_MODEL")
    if not model or not model.strip():
        raise RuntimeError(
            "GEMINI_MODEL is not set. "
            "Add it to backend/.env, e.g.: GEMINI_MODEL=gemini-3.6-flash"
        )
    return model.strip()

def is_configured() -> bool:
    """True when the SDK is available AND the API key is set."""
    key = _api_key()
    return bool(_GENAI_AVAILABLE and key and key.strip())


# ─────────────────────────────────────────────────────────────────────────────
# Retry settings
# ─────────────────────────────────────────────────────────────────────────────

MAX_ATTEMPTS: int = 3                 # total attempts (1 initial + 2 retries)
INITIAL_BACKOFF_SEC: float = 1.0      # first retry waits 1 s; then 2 s, 4 s …
MAX_BACKOFF_SEC: float = 8.0          # cap a single wait

# HTTP status codes that are worth retrying (temporary failures)
_RETRYABLE_STATUS_CODES: set[int] = {408, 429, 503, 504}

# Request timeout for the Gemini API call (seconds)
_GEMINI_TIMEOUT_SEC: float = 60.0
_MAX_OUTPUT_TOKENS: int = 8192
_THINKING_BUDGET: int = 128


class GeminiAPIError(RuntimeError):
    def __init__(self, status_code: Optional[int], message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


class GeminiOutputError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ─────────────────────────────────────────────────────────────────────────────
# Prompt
# ─────────────────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are an expert restaurant bill parser for the SplitMate AI application.
Your task is to extract every detail from the provided bill image and return
a single, valid JSON object — nothing else.

RULES (follow strictly):
1. Output ONLY the JSON object. No markdown, no code fences, no prose.
2. Do NOT invent values for fields you cannot read. Use null instead.
3. Return all amounts as decimal numbers in the major currency unit exactly
   as printed (e.g. 180.50). Never convert to paise or cents.
4. For currency: use "INR", "USD", "EUR", "GBP", or "UNKNOWN" if unclear.
5. Confidence scores: 0.0 (unreadable) to 1.0 (perfectly clear).
6. If an item total does not equal qty × unit_price, record both as you read
   them and add a warning string explaining the discrepancy.
7. items[] contains ONLY purchasable line items. Never include subtotal, tax,
   CGST, SGST, IGST, VAT, GST, service charge, discount, round-off,
   packaging/delivery fee, tip, or total lines as items.
8. gst_amount is the sum of all tax lines (CGST + SGST + IGST + VAT).
9. Discounts are positive numbers. Keep packaging/delivery/etc. in
   other_charges and bill rounding adjustments in round_off.
10. Read Indian number formats such as "1,250.00", "Rs.", and "₹" correctly.
    In tables, Rate/Price is the unit price; Amount is the line total.
11. Skip void or cancelled items.
12. Support handwritten bills, printed receipts, and photos of screens.

REQUIRED JSON STRUCTURE:
{
  "restaurant_name": string | null,
  "items": [
    {
      "name": string,
      "qty": number,
      "unit_price": number | null,
      "item_total": number | null,
      "confidence": number
    }
  ],
  "subtotal": number | null,
  "gst_amount": number | null,
  "discount_amount": number | null,
  "service_charge": number | null,
  "other_charges": number | null,
  "round_off": number | null,
  "grand_total": number | null,
  "currency": string,
  "overall_confidence": number,
  "warnings": [string]
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Paise conversion helpers
# ─────────────────────────────────────────────────────────────────────────────

def _to_paise(rupees: Optional[float]) -> Optional[int]:
    if rupees is None:
        return None
    return rupees_to_paise(rupees)

def _item_to_paise(raw: RawItemSchema) -> tuple[int, int, bool]:
    qty = raw.qty
    unit_price_paise = (
        rupees_to_paise(abs(raw.unit_price)) if raw.unit_price is not None else None
    )
    line_total_paise = (
        rupees_to_paise(abs(raw.item_total)) if raw.item_total is not None else None
    )

    if line_total_paise is not None:
        if unit_price_paise is None:
            unit_price_paise = int(
                (Decimal(line_total_paise) / Decimal(str(qty))).quantize(
                    Decimal("1"), rounding=ROUND_HALF_UP
                )
            )
            unit_price_inferred = True
        else:
            unit_price_inferred = False
    elif unit_price_paise is not None:
        line_total_paise = int(
            (Decimal(unit_price_paise) * Decimal(str(qty))).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        unit_price_inferred = False
    else:
        unit_price_paise = 0
        line_total_paise = 0
        unit_price_inferred = False

    return unit_price_paise, line_total_paise, unit_price_inferred


_NON_ITEM_LINE = re.compile(
    r"^(?:sub[\s-]*total|grand[\s-]*total|total|tax|gst|cgst|sgst|igst|vat|"
    r"service[\s-]*charge|other[\s-]*charge|discount|round(?:[\s-]*off|ing)|"
    r"packaging|delivery|tip)\b",
    re.IGNORECASE,
)
_VOID_ITEM = re.compile(r"\b(?:void|cancel(?:led|ed)?)\b", re.IGNORECASE)


def _is_purchasable_item(name: str) -> bool:
    return not _NON_ITEM_LINE.search(name.strip()) and not _VOID_ITEM.search(name)


def _coerce_gemini_output(data: object) -> RawGeminiOutput:
    if not isinstance(data, dict):
        raise ValueError("Gemini output must be a JSON object.")

    payload = dict(data)
    warnings = [
        warning for warning in payload.get("warnings", [])
        if isinstance(warning, str)
    ] if isinstance(payload.get("warnings", []), list) else []
    items = payload.get("items", [])
    if not isinstance(items, list):
        items = []
        warnings.append("Gemini returned an invalid items list.")

    clean_items = []
    for index, item in enumerate(items, start=1):
        item_data = dict(item) if isinstance(item, dict) else {}
        name = item_data.get("name")
        if not isinstance(name, str) or not name.strip():
            name = f"Unreadable item {index}"
            warnings.append(f"Item {index} had no readable name.")

        try:
            qty = float(item_data.get("qty", 1))
            if not math.isfinite(qty) or qty <= 0:
                raise ValueError
        except (TypeError, ValueError):
            qty = 1.0
            warnings.append(f"Item '{name}' had an invalid quantity; using 1.")

        clean_item = {"name": name.strip(), "qty": qty}
        for field in ("unit_price", "item_total"):
            raw_amount = item_data.get(field)
            amount = parse_currency_amount(raw_amount)
            if raw_amount is not None and amount is None:
                warnings.append(f"Item '{name}' has an unreadable {field.replace('_', ' ')}.")
            clean_item[field] = amount

        try:
            confidence = float(item_data.get("confidence", 0.8))
            if not math.isfinite(confidence):
                raise ValueError
            clean_item["confidence"] = min(1.0, max(0.0, confidence))
        except (TypeError, ValueError):
            clean_item["confidence"] = 0.3
            warnings.append(f"Item '{name}' has an invalid confidence score.")
        clean_items.append(clean_item)

    payload["items"] = clean_items
    payload["warnings"] = warnings
    for field in (
        "subtotal",
        "gst_amount",
        "discount_amount",
        "service_charge",
        "other_charges",
        "round_off",
        "grand_total",
    ):
        raw_amount = payload.get(field)
        amount = parse_currency_amount(raw_amount)
        if raw_amount is not None and amount is None:
            warnings.append(f"Gemini returned an unreadable {field.replace('_', ' ')}.")
        payload[field] = amount

    if not isinstance(payload.get("currency"), str):
        payload["currency"] = "UNKNOWN"
    try:
        confidence = float(payload.get("overall_confidence", 0.5))
        if not math.isfinite(confidence):
            raise ValueError
        payload["overall_confidence"] = min(1.0, max(0.0, confidence))
    except (TypeError, ValueError):
        payload["overall_confidence"] = 0.3
        warnings.append("Gemini returned an invalid overall confidence score.")

    return RawGeminiOutput.model_validate(payload)


# ─────────────────────────────────────────────────────────────────────────────
# JSON extraction helper
# ─────────────────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    text = text.strip()
    if text.startswith("{"):
        return text
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        return fence_match.group(1)
    brace_match = re.search(r"\{.*\}", text, re.DOTALL)
    if brace_match:
        return brace_match.group(0)
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Error helpers
# ─────────────────────────────────────────────────────────────────────────────

def _error_status_code(exc: Exception) -> Optional[int]:
    """Extract the HTTP status code from a google-genai error, if present."""
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code
    # Some errors store it in args[0] as a string like "429 ..."
    if exc.args:
        match = re.match(r"^(\d{3})\b", str(exc.args[0]))
        if match:
            return int(match.group(1))
    return None


def _is_timeout_exception(exc: Exception) -> bool:
    exception_type = type(exc)
    type_name = exception_type.__name__.lower()
    module_name = exception_type.__module__.lower()
    return (
        isinstance(exc, (TimeoutError, asyncio.TimeoutError))
        or (
            "timeout" in type_name
            and (module_name.startswith("httpx") or module_name.startswith("httpcore"))
        )
    )


def _is_retryable(exc: Exception) -> bool:
    """Return True for rate limits, server errors, and request timeouts."""
    code = _error_status_code(exc)
    if code is not None:
        return code in _RETRYABLE_STATUS_CODES or 500 <= code <= 599
    if _is_timeout_exception(exc):
        return True
    # ServerError subclass is always 5xx — retry those too
    if _GENAI_AVAILABLE and isinstance(exc, genai_errors.ServerError):
        return True
    return False


def _build_model_not_found_message(model: str, exc: Exception) -> str:
    """
    Construct a clear error message for 404 model-not-found, including
    instructions for listing supported models via the SDK.
    """
    return (
        f"Gemini model '{model}' is not available (HTTP 404). "
        f"The model name may have changed or been deprecated.\n\n"
        f"To see currently supported models, run:\n"
        f"    python -c \""
        f"import google.genai as genai; "
        f"c = genai.Client(api_key='YOUR_KEY'); "
        f"print([m.name for m in c.models.list()])"
        f"\"\n\n"
        f"Then set the correct model name in backend/.env as GEMINI_MODEL=<name> "
        f"and restart the server.\n\n"
        f"Original error: {exc}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Core API call with retry
# ─────────────────────────────────────────────────────────────────────────────

async def _call_gemini_with_retry(
    client: "genai.Client",
    model: str,
    image_part,
    config,
) -> "genai_types.GenerateContentResponse":
    """
    Call client.aio.models.generate_content with exponential-backoff retries.

    Retries only on 429 and 503.  Permanent 4xx errors are raised immediately.
    Raises a RuntimeError with a clear message when all attempts are exhausted.
    """
    last_exc: Optional[Exception] = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=[image_part],
                config=config,
            )
            if attempt > 1:
                logger.info("Gemini call succeeded on attempt %d/%d", attempt, MAX_ATTEMPTS)
            return response

        except genai_errors.ClientError as exc:
            code = _error_status_code(exc)

            # 404 — model not found: permanent, with a helpful message
            if code == 404:
                logger.error("Gemini model '%s' not found (404)", model)
                raise GeminiAPIError(
                    404,
                    _build_model_not_found_message(model, exc),
                ) from exc

            # Rate limits and transient gateway/server errors are retryable.
            if _is_retryable(exc):
                last_exc = exc
                if attempt < MAX_ATTEMPTS:
                    wait = min(INITIAL_BACKOFF_SEC * (2 ** (attempt - 1)), MAX_BACKOFF_SEC)
                    logger.warning(
                        "Gemini transient client error (code=%s) on attempt %d/%d. "
                        "Retrying in %.1f s…",
                        code, attempt, MAX_ATTEMPTS, wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                else:
                    logger.error(
                        "Gemini transient client error (code=%s) — all %d attempts exhausted",
                        code,
                        MAX_ATTEMPTS,
                    )
                    break

            logger.error("Gemini client error (code=%s): %s", code, exc)
            raise GeminiAPIError(code, str(exc)) from exc

        except genai_errors.ServerError as exc:
            code = _error_status_code(exc)

            last_exc = exc
            if attempt < MAX_ATTEMPTS:
                wait = min(INITIAL_BACKOFF_SEC * (2 ** (attempt - 1)), MAX_BACKOFF_SEC)
                logger.warning(
                    "Gemini server error on attempt %d/%d. Retrying in %.1f s…",
                    attempt, MAX_ATTEMPTS, wait,
                )
                await asyncio.sleep(wait)
                continue
            break

        except Exception as exc:
            if _is_retryable(exc):
                last_exc = exc
                if attempt < MAX_ATTEMPTS:
                    wait = min(INITIAL_BACKOFF_SEC * (2 ** (attempt - 1)), MAX_BACKOFF_SEC)
                    logger.warning(
                        "Gemini request timed out on attempt %d/%d. Retrying in %.1f s…",
                        attempt,
                        MAX_ATTEMPTS,
                        wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                break

            logger.error("Unexpected Gemini error: %s", exc)
            raise GeminiAPIError(_error_status_code(exc), str(exc)) from exc

    # All retries exhausted
    code = _error_status_code(last_exc) if last_exc else "unknown"
    raise GeminiAPIError(
        code if isinstance(code, int) else 503,
        f"Gemini Vision request failed after {MAX_ATTEMPTS} attempts "
        f"(last upstream status: {code}).",
    ) from last_exc


# ─────────────────────────────────────────────────────────────────────────────
# Public extraction function
# ─────────────────────────────────────────────────────────────────────────────

async def extract_bill_items(
    image_bytes: bytes,
    mime_type: str,
) -> RawGeminiOutput:
    """
    Send a bill image to Gemini Vision and return a validated RawGeminiOutput.

    Args:
        image_bytes: Raw bytes of the uploaded image (held in memory only).
        mime_type:   MIME type, e.g. "image/jpeg" or "image/png".

    Returns:
        RawGeminiOutput with items, totals, currency, warnings.

    Raises:
        RuntimeError:  SDK not installed, API key missing, model not found,
                       or all retries exhausted.
        ValueError:    Gemini returned content that cannot be parsed as valid JSON.
    """
    if not _GENAI_AVAILABLE:
        raise RuntimeError(
            "google-genai SDK is not installed. Run: pip install google-genai"
        )

    api_key = _api_key()
    if not api_key or not api_key.strip():
        raise RuntimeError(
            "GEMINI_API_KEY is not set. "
            "Add it to backend/.env and restart the server."
        )

    try:
        model = _model_name()
    except RuntimeError as exc:
        raise GeminiAPIError(503, str(exc)) from exc

    client = genai.Client(api_key=api_key)

    image_part = genai_types.Part.from_bytes(
        data=image_bytes,
        mime_type=mime_type,
    )

    thinking_config = None
    if model.startswith("gemini-2.5"):
        thinking_config = genai_types.ThinkingConfig(thinking_budget=_THINKING_BUDGET)
    elif model.startswith("gemini-3"):
        thinking_config = genai_types.ThinkingConfig(thinking_level="low")

    config = genai_types.GenerateContentConfig(
        system_instruction=_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=RawGeminiOutput,
        temperature=0.1,
        max_output_tokens=_MAX_OUTPUT_TOKENS,
        thinking_config=thinking_config,
        # Request-level timeout
        http_options=genai_types.HttpOptions(timeout=int(_GEMINI_TIMEOUT_SEC * 1000)),
    )

    logger.info(
        "Calling Gemini model=%s image_bytes=%d mime=%s (env GEMINI_MODEL=%s)",
        model,
        len(image_bytes),
        mime_type,
        os.getenv("GEMINI_MODEL"),
    )

    # ── Call with retry ────────────────────────────────────────────────────────
    response = await _call_gemini_with_retry(client, model, image_part, config)

    prompt_feedback = getattr(response, "prompt_feedback", None)
    block_reason = getattr(prompt_feedback, "block_reason", None)
    block_name = getattr(block_reason, "name", str(block_reason)).upper()
    if block_reason is not None and "SAFETY" in block_name:
        raise GeminiOutputError(
            "SAFETY",
            "Gemini blocked this image under its safety rules. Try another bill image.",
        )

    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        raise GeminiOutputError(
            "EMPTY_OUTPUT",
            "Gemini returned no candidates and no readable bill data.",
        )
    finish_reason = getattr(candidates[0], "finish_reason", None)
    finish_name = getattr(finish_reason, "name", str(finish_reason)).upper()
    if "MAX_TOKENS" in finish_name:
        raise GeminiOutputError(
            "MAX_TOKENS",
            "Gemini's bill response exceeded its output-token limit. Try a clearer or more tightly cropped image.",
        )
    if "SAFETY" in finish_name:
        raise GeminiOutputError(
            "SAFETY",
            "Gemini blocked this image under its safety rules. Try another bill image.",
        )

    raw_text = (response.text or "").strip()
    if not raw_text:
        raise GeminiOutputError(
            "EMPTY_OUTPUT",
            "Gemini returned an empty response. Check that the bill is visible and try again.",
        )

    logger.debug("Gemini raw response length: %d chars", len(raw_text))

    # ── Parse JSON ────────────────────────────────────────────────────────────
    try:
        json_str = _extract_json(raw_text)
        data = json.loads(json_str)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("JSON parse error. Response length: %d chars", len(raw_text))
        raise ValueError(
            f"Gemini response could not be parsed as JSON: {exc}. "
            "The model may not have produced structured output for this image."
        ) from exc

    # ── Validate against Pydantic model ───────────────────────────────────────
    try:
        result = _coerce_gemini_output(data)
    except Exception as exc:
        logger.error("Pydantic validation of Gemini output failed: %s", exc)
        raise ValueError(
            f"Gemini output failed schema validation: {exc}"
        ) from exc

    logger.info(
        "Gemini extraction complete: %d items, currency=%s, confidence=%.2f, warnings=%d",
        len(result.items),
        result.currency,
        result.overall_confidence,
        len(result.warnings),
    )

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Public helper: convert RawGeminiOutput → API-ready dicts
# ─────────────────────────────────────────────────────────────────────────────

def build_extracted_items(raw: RawGeminiOutput) -> list[dict]:
    """
    Convert RawGeminiOutput.items into a list of dicts compatible with
    ExtractedItemSchema — with paise values and unique ids.
    """
    result = []
    for raw_item in raw.items:
        if not _is_purchasable_item(raw_item.name):
            continue

        unit_price_paise, line_total_paise, inferred = _item_to_paise(raw_item)
        warnings = []
        confidence = raw_item.confidence
        if raw_item.unit_price is None and raw_item.item_total is None:
            warnings.append(f"Item '{raw_item.name}' price unreadable.")
            confidence = min(confidence, 0.3)

        result.append({
            "id": f"ocr_{uuid.uuid4().hex[:8]}",
            "name": raw_item.name.strip(),
            "qty": raw_item.qty,
            "unit_price_paise": unit_price_paise,
            "line_total_paise": line_total_paise,
            "unit_price_inferred": inferred,
            "confidence": confidence,
            "gemini_warnings": warnings,
        })
    return result
