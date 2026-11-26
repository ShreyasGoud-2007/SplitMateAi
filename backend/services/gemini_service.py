"""
gemini_service.py
Gemini Vision OCR integration for SplitMate AI.

Uses google-genai 3.x SDK:
    client = genai.Client(api_key=...)
    response = await client.aio.models.generate_content(
        model=..., contents=[...], config=GenerateContentConfig(...)
    )

Reliability:
    - Retries 429 (rate limit) and 503 (service unavailable) with exponential
      backoff, up to MAX_ATTEMPTS times.
    - Permanent 4xx errors (400, 401, 403, 404) are NOT retried.
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
import os
import re
import uuid
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
from schemas.bill_schema import RawGeminiOutput, RawItemSchema


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
_RETRYABLE_STATUS_CODES: set[int] = {429, 503}

# Request timeout for the Gemini API call (seconds)
_GEMINI_TIMEOUT_SEC: float = 60.0


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
3. All monetary amounts must be in the currency printed on the bill.
   Convert to that currency's smallest sub-unit (e.g. paise for INR,
   cents for USD) only if you are certain of the value.
   Return amounts as FLOATS in the currency's major unit (e.g. rupees,
   dollars) — the backend will convert to integer sub-units.
4. For currency: use "INR", "USD", "EUR", "GBP", or "UNKNOWN" if unclear.
5. Confidence scores: 0.0 (unreadable) to 1.0 (perfectly clear).
6. If an item total does not equal qty × unit_price, record both as you read
   them and add a warning string explaining the discrepancy.
7. Support handwritten bills, printed receipts, and photos of screens.

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
    return round(rupees * 100)

def _item_to_paise(raw: RawItemSchema) -> tuple[int, int]:
    qty = max(int(round(raw.qty)), 1)

    if raw.unit_price is not None:
        up = round(raw.unit_price * 100)
        lt = up * qty
    elif raw.item_total is not None:
        lt = round(raw.item_total * 100)
        up = lt // qty
    else:
        up, lt = 0, 0

    return up, lt


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


def _is_retryable(exc: Exception) -> bool:
    """Return True only for transient errors (429 rate-limit, 503 unavailable)."""
    code = _error_status_code(exc)
    if code is not None:
        return code in _RETRYABLE_STATUS_CODES
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
                raise RuntimeError(_build_model_not_found_message(model, exc)) from exc

            # 429 — rate limit: retryable
            if _is_retryable(exc):
                last_exc = exc
                if attempt < MAX_ATTEMPTS:
                    wait = min(INITIAL_BACKOFF_SEC * (2 ** (attempt - 1)), MAX_BACKOFF_SEC)
                    logger.warning(
                        "Gemini rate-limited (429) on attempt %d/%d. "
                        "Retrying in %.1f s…",
                        attempt, MAX_ATTEMPTS, wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                else:
                    logger.error("Gemini rate-limited (429) — all %d attempts exhausted", MAX_ATTEMPTS)
                    break

            # Other 4xx (400, 401, 403) — permanent, do not retry
            logger.error("Gemini client error (code=%s): %s", code, exc)
            raise

        except genai_errors.ServerError as exc:
            code = _error_status_code(exc)

            # 503 — service unavailable: retryable
            if _is_retryable(exc):
                last_exc = exc
                if attempt < MAX_ATTEMPTS:
                    wait = min(INITIAL_BACKOFF_SEC * (2 ** (attempt - 1)), MAX_BACKOFF_SEC)
                    logger.warning(
                        "Gemini server error (code=%s) on attempt %d/%d. "
                        "Retrying in %.1f s…",
                        code, attempt, MAX_ATTEMPTS, wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                else:
                    logger.error("Gemini server error (code=%s) — all %d attempts exhausted", code, MAX_ATTEMPTS)
                    break

            # Other 5xx — also retryable
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
            # Unexpected error — don't retry, surface immediately
            logger.error("Unexpected Gemini error: %s", exc)
            raise

    # All retries exhausted
    code = _error_status_code(last_exc) if last_exc else "unknown"
    raise RuntimeError(
        f"Gemini Vision API is temporarily unavailable after {MAX_ATTEMPTS} attempts "
        f"(last error: HTTP {code}). This is usually caused by high demand or "
        f"rate limiting. Please wait a moment and try again."
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

    model = _model_name()

    client = genai.Client(api_key=api_key)

    image_part = genai_types.Part.from_bytes(
        data=image_bytes,
        mime_type=mime_type,
    )

    config = genai_types.GenerateContentConfig(
        system_instruction=_SYSTEM_PROMPT,
        response_mime_type="application/json",
        temperature=0.1,
        max_output_tokens=4096,
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

    raw_text = (response.text or "").strip()
    if not raw_text:
        raise ValueError(
            "Gemini returned an empty response. "
            "The image may be too dark, blurry, or cropped. "
            "Please retake the photo and try again."
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
        result = RawGeminiOutput.model_validate(data)
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
        qty = max(int(round(raw_item.qty)), 1)
        up_paise, lt_paise = _item_to_paise(raw_item)

        result.append({
            "id": f"ocr_{uuid.uuid4().hex[:8]}",
            "name": raw_item.name.strip(),
            "qty": qty,
            "unit_price_paise": up_paise,
            "line_total_paise": lt_paise,
            "confidence": raw_item.confidence,
        })
    return result
