"""
main.py
SplitMate AI — FastAPI application entry point.

Start the development server:
    cd backend
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

The backend is kept separate from the React Native / Expo frontend.
OCR providers and their credentials are configured here, never in the mobile app.
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
from services.ocr_provider import get_ocr_provider

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
    """Log the selected provider and validate only its required configuration."""
    provider = get_ocr_provider()
    logger.info("OCR provider selected: %s", provider)

    if provider == "gemini":
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        gemini_model = os.getenv("GEMINI_MODEL", "")

        if not gemini_key or not gemini_key.strip():
            logger.error(
                "GEMINI_API_KEY is not set or empty — Gemini OCR requests return 503. "
                "Add the key to backend/.env and restart the server."
            )
        else:
            logger.info("Gemini API key is configured.")

        if not gemini_model or not gemini_model.strip():
            logger.error(
                "GEMINI_MODEL is not set — Gemini OCR requests cannot run. "
                "Set GEMINI_MODEL in backend/.env."
            )
        else:
            logger.info("Gemini model: %s", gemini_model)

        from services import gemini_service
        if not gemini_service._GENAI_AVAILABLE:
            logger.error(
                "google-genai package is not installed. "
                "Run: pip install -r requirements.txt"
            )
        elif gemini_service.is_configured():
            logger.info("Gemini OCR service ready.")
    else:
        logger.info(
            "PaddleOCR CPU provider selected (PP-OCRv5 mobile models; "
            "models initialize lazily on the first OCR request)."
        )

    logger.info("SplitMate AI backend starting up.")
    yield
    logger.info("SplitMate AI backend shutting down.")


# ── App factory ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="SplitMate AI",
    description=(
        "Backend API for the SplitMate AI application. "
        "Supports Gemini Vision and CPU PaddleOCR for restaurant bill extraction."
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
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=(
        r"^https?://(?:(?:localhost|127(?:\.\d{1,3}){3})|"
        r"10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$"
    ),
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
