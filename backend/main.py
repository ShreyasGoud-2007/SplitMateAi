"""
main.py
SplitMate AI — FastAPI application entry point.

Start the development server:
    cd backend
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

The backend is kept separate from the React Native / Expo frontend.
Gemini API keys live exclusively here, never in the mobile app.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.ocr import router as ocr_router
from schemas.bill_schema import HealthResponse

# ── Environment ───────────────────────────────────────────────────────────────

# Load .env before anything else so os.getenv() works in every module.
# override=True ensures .env always wins over inherited environment variables
# (critical for uvicorn --reload, where the parent process may have stale env).
load_dotenv(
    dotenv_path=os.path.join(os.path.dirname(__file__), ".env"),
    override=True,
)

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("splitmate")

# ── Lifespan (startup / shutdown hooks) ──────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Log startup state and validate configuration."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    gemini_model = os.getenv("GEMINI_MODEL", "")

    # ── Startup validation ───────────────────────────────────────────────────
    if not gemini_key or not gemini_key.strip():
        logger.error(
            "GEMINI_API_KEY is not set or empty — OCR endpoint will return 503. "
            "Add your API key to backend/.env and restart the server."
        )
    else:
        # Confirm the key loaded without leaking it.
        logger.info("Gemini API key loaded (prefix: %s…)", gemini_key[:8])

    if not gemini_model or not gemini_model.strip():
        logger.error(
            "GEMINI_MODEL is not set — using default. "
            "Set GEMINI_MODEL in backend/.env to specify the model name."
        )
    else:
        logger.info("Gemini model: %s", gemini_model)

    # Warn if the SDK itself is unavailable
    try:
        from services import gemini_service
        if not gemini_service._GENAI_AVAILABLE:
            logger.error(
                "google-genai package is not installed. "
                "Run: pip install google-genai"
            )
        elif not gemini_service.is_configured():
            logger.error(
                "Gemini is not fully configured. "
                "Check GEMINI_API_KEY and GEMINI_MODEL in backend/.env."
            )
        else:
            logger.info("Gemini OCR service ready.")
    except Exception as exc:
        logger.error("Failed to initialise Gemini service: %s", exc)

    logger.info("SplitMate AI backend starting up.")
    yield
    logger.info("SplitMate AI backend shutting down.")


# ── App factory ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="SplitMate AI",
    description=(
        "Backend API for the SplitMate AI Android application. "
        "Handles Gemini Vision OCR for restaurant bill extraction and splitting. "
        "All Gemini API keys are stored exclusively on this server."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow Expo development origins.  Extend this list as needed for staging /
# production — never use allow_origins=["*"] in production.

CORS_ORIGINS: list[str] = [
    # Expo Go / Metro bundler on the developer's machine
    "http://localhost:8081",
    "http://localhost:19000",
    "http://localhost:19001",
    "http://localhost:19002",
    # Expo web
    "http://localhost:3000",
    # LAN address used by Expo Go on a physical Android device
    # (replace with your machine's local IP when testing on a real device)
    "http://192.168.1.0/24",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(ocr_router)

# ── Core routes ───────────────────────────────────────────────────────────────

@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    tags=["Health"],
)
async def health_check() -> HealthResponse:
    """
    Returns a simple liveness probe.
    The React Native app can call this before attempting an OCR upload
    to confirm the backend is reachable.
    """
    return HealthResponse(status="healthy", app="SplitMate AI")
