"""
test_gemini_connection.py
Diagnostic script for Gemini Vision API connectivity.

Run:
    cd backend
    python test_gemini_connection.py

Checks performed:
  1. Loads GEMINI_API_KEY and GEMINI_MODEL from .env
  2. Verifies the configured model exists in the API's model list
  3. Makes one minimal text-generation request
  4. Reports exact HTTP status, error message, and diagnosis

Security:
  - The API key is never printed or logged.
  - No image data is sent — this is a text-only connectivity test.
  - No fake OCR results are generated.

This script is separate from the production OCR endpoint.
"""

from __future__ import annotations

import os
import sys
import traceback

# ── Load environment ─────────────────────────────────────────────────────────

from dotenv import load_dotenv

# override=True ensures .env always wins over inherited environment variables,
# matching the behavior in main.py.
load_dotenv(
    dotenv_path=os.path.join(os.path.dirname(__file__), ".env"),
    override=True,
)

API_KEY = os.getenv("GEMINI_API_KEY", "")
MODEL_NAME = os.getenv("GEMINI_MODEL", "")


# ── Diagnostic helpers ────────────────────────────────────────────────────────

def _mask_key(key: str) -> str:
    """Show first 8 and last 4 chars only."""
    if not key:
        return "<empty>"
    if len(key) <= 12:
        return key[:4] + "…" + key[-2:]
    return key[:8] + "…" + key[-4:]


def _classify_error(status_code: int | None, message: str) -> str:
    """Return a human-readable diagnosis based on HTTP status code."""
    if status_code is None:
        return "Unknown error — no HTTP status code available."
    if status_code == 400:
        return "BAD REQUEST (400): The API rejected the request format. Check the model name and request payload."
    if status_code == 401:
        return "INVALID API KEY (401): The key was rejected. Generate a new one at https://aistudio.google.com/apikey"
    if status_code == 403:
        if "quota" in message.lower() or "exhausted" in message.lower():
            return "QUOTA EXHAUSTED (403): The API key has no remaining quota. Check billing at https://aistudio.google.com/usage"
        return "PERMISSION DENIED (403): The API key lacks access to this model or the Generative Language API is not enabled."
    if status_code == 404:
        return f"MODEL NOT FOUND (404): '{MODEL_NAME}' is not a valid model name. See the model list printed above."
    if status_code == 429:
        return "RATE LIMITED (429): Too many requests. Wait a moment and retry."
    if status_code == 500:
        return "GOOGLE SERVER ERROR (500): Internal Gemini error. Retry after a short wait."
    if status_code == 503:
        return "SERVICE UNAVAILABLE (503): Gemini is temporarily overloaded. Retry after a short wait."
    if status_code == 504:
        return "GATEWAY TIMEOUT (504): Gemini did not respond in time. The model may be under high load."
    return f"UNEXPECTED ERROR (HTTP {status_code}): See the full error message above."


# ── Main diagnostic ──────────────────────────────────────────────────────────

def run_diagnostic() -> int:
    """
    Run all checks and print results.
    Returns exit code: 0 = pass, 1 = fail.
    """
    print("=" * 70)
    print("  SplitMate AI — Gemini Vision API Diagnostic")
    print("=" * 70)
    print()

    # ── Step 1: Check configuration ──────────────────────────────────────────
    print("[1/4] Configuration Check")
    print(f"  API key:      {_mask_key(API_KEY)}")
    print(f"  Model name:   {MODEL_NAME or '<not set>'}")
    print()

    if not API_KEY or not API_KEY.strip():
        print("  FAIL: GEMINI_API_KEY is not set in backend/.env")
        print("  Fix:  Add your key to backend/.env, e.g.:")
        print("        GEMINI_API_KEY=your_key_here")
        return 1

    if not MODEL_NAME or not MODEL_NAME.strip():
        print("  FAIL: GEMINI_MODEL is not set in backend/.env")
        print("  Fix:  Add a model name to backend/.env, e.g.:")
        print("        GEMINI_MODEL=gemini-2.0-flash")
        return 1

    print("  PASS: Both variables are set.")
    print()

    # ── Step 2: SDK import check ─────────────────────────────────────────────
    print("[2/4] SDK Import Check")
    try:
        import google.genai as genai
        from google.genai import errors as genai_errors
        print(f"  PASS: google-genai SDK imported (version {genai.__version__})")
    except ImportError:
        print("  FAIL: google-genai is not installed.")
        print("  Fix:  pip install google-genai")
        return 1
    print()

    # ── Step 3: Model availability check ─────────────────────────────────────
    print("[3/4] Model Availability Check")
    client = genai.Client(api_key=API_KEY)

    try:
        available_models = []
        for m in client.models.list():
            available_models.append(m.name)

        print(f"  API returned {len(available_models)} models.")
        print()

        # Show models that support generateContent (text/vision)
        print("  Available models:")
        for name in available_models:
            marker = " ← CONFIGURED" if name == MODEL_NAME else ""
            # Also check if the configured model matches with or without prefix
            if name == MODEL_NAME or name == f"models/{MODEL_NAME}":
                marker = " ← CONFIGURED"
            print(f"    {name}{marker}")
        print()

        # Check if the configured model is in the list
        configured_found = (
            MODEL_NAME in available_models
            or f"models/{MODEL_NAME}" in available_models
        )

        if configured_found:
            print(f"  PASS: '{MODEL_NAME}' is available.")
        else:
            print(f"  WARNING: '{MODEL_NAME}' was NOT found in the model list.")
            print(f"  The model may have been renamed or deprecated.")
            print(f"  Check the list above for the correct name and update GEMINI_MODEL in backend/.env.")
            print()

    except genai_errors.ClientError as exc:
        code = getattr(exc, "code", None)
        msg = str(exc)
        print(f"  FAIL: Could not list models — HTTP {code}")
        print(f"  Error: {msg}")
        print()
        print(f"  Diagnosis: {_classify_error(code, msg)}")
        return 1
    except Exception as exc:
        print(f"  FAIL: Unexpected error while listing models: {exc}")
        traceback.print_exc()
        return 1
    print()

    # ── Step 4: Minimal text-generation test ────────────────────────────────
    print("[4/4] Connectivity Test — Minimal Text Generation")
    print(f"  Sending a simple text prompt to '{MODEL_NAME}'…")
    print()

    try:
        from google.genai import types as genai_types

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents="Reply with exactly one word: OK",
            config=genai_types.GenerateContentConfig(
                max_output_tokens=10,
                temperature=0.0,
            ),
        )

        text = (response.text or "").strip()
        print(f"  PASS: Gemini responded.")
        print(f"  Response text: {text[:100]}")
        print()
        print("=" * 70)
        print("  RESULT: Gemini API is reachable and the model is working.")
        print("  The 503/504 errors were temporary. The OCR endpoint should")
        print("  work now — retry your bill upload.")
        print("=" * 70)
        return 0

    except genai_errors.ClientError as exc:
        code = getattr(exc, "code", None)
        msg = str(exc)
        print(f"  FAIL: ClientError — HTTP {code}")
        print(f"  Full error: {msg}")
        print()
        print(f"  Diagnosis: {_classify_error(code, msg)}")
        print()

        if code == 403 and "quota" in msg.lower():
            print("  Additional: Check your API key quota and billing:")
            print("    https://aistudio.google.com/usage")
        elif code == 404:
            print("  Additional: The model name may have changed.")
            print("  Update GEMINI_MODEL in backend/.env to one of the models listed above.")
        elif code == 429:
            print("  Additional: Rate limit hit. Wait 30-60 seconds and re-run this script.")

        print("=" * 70)
        print("  RESULT: Gemini API returned a permanent error.")
        print("=" * 70)
        return 1

    except genai_errors.ServerError as exc:
        code = getattr(exc, "code", None)
        msg = str(exc)
        print(f"  FAIL: ServerError — HTTP {code}")
        print(f"  Full error: {msg}")
        print()
        print(f"  Diagnosis: {_classify_error(code, msg)}")
        print()

        if code in (503, 504):
            print("  This is a temporary Google-side issue.")
            print("  The model is under high demand. Options:")
            print("    1. Wait a few minutes and retry.")
            print("    2. Try a different model (see list above).")
            print("    3. The retry logic in gemini_service.py will handle")
            print("       this automatically during normal operation.")

        print("=" * 70)
        print("  RESULT: Gemini API is temporarily unavailable (server-side).")
        print("  This is NOT a configuration problem — retry later.")
        print("=" * 70)
        return 1

    except Exception as exc:
        print(f"  FAIL: Unexpected error type: {type(exc).__name__}")
        print(f"  Error: {exc}")
        traceback.print_exc()
        print()
        print("=" * 70)
        print("  RESULT: Unexpected error — check the traceback above.")
        print("=" * 70)
        return 1


if __name__ == "__main__":
    sys.exit(run_diagnostic())
