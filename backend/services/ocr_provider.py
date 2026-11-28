from __future__ import annotations

import os
from typing import Literal

OCRProviderName = Literal["gemini", "paddleocr"]


def get_ocr_provider() -> OCRProviderName:
    provider = os.getenv("OCR_PROVIDER", "gemini").strip().lower()
    if provider == "gemini":
        return "gemini"
    if provider == "paddleocr":
        return "paddleocr"
    raise ValueError("OCR_PROVIDER must be either 'gemini' or 'paddleocr'.")
