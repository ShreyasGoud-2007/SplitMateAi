from __future__ import annotations

import asyncio
import sys
from io import BytesIO
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from routes import ocr as ocr_route
from schemas.bill_schema import CurrencyCode
from services import gemini_service, paddleocr_service
from services.ocr_provider import get_ocr_provider
from services.validation_service import validate_bill


def test_provider_config_defaults_to_gemini_and_accepts_paddleocr(monkeypatch):
    monkeypatch.delenv("OCR_PROVIDER", raising=False)
    assert get_ocr_provider() == "gemini"

    monkeypatch.setenv("OCR_PROVIDER", "PaddleOCR")
    assert get_ocr_provider() == "paddleocr"


def test_provider_config_rejects_unknown_provider(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "automatic")

    with pytest.raises(ValueError, match="OCR_PROVIDER"):
        get_ocr_provider()


def test_engine_uses_cpu_and_mobile_models(monkeypatch):
    captured: dict = {}

    class FakePaddleOCR:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    fake_module = ModuleType("paddleocr")
    fake_module.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)
    monkeypatch.setattr(paddleocr_service, "_ENGINE", None)

    engine = paddleocr_service._get_engine()

    assert isinstance(engine, FakePaddleOCR)
    assert captured["device"] == "cpu"
    assert captured["engine"] == "paddle"
    assert captured["text_detection_model_name"] == "PP-OCRv5_mobile_det"
    assert captured["text_recognition_model_name"] == "PP-OCRv5_mobile_rec"
    assert captured["use_doc_orientation_classify"] is False
    assert captured["use_doc_unwarping"] is False
    assert captured["use_textline_orientation"] is False
    assert captured["engine_config"] == {"paddle_static": {"cpu_threads": 2}}


def test_regions_are_extracted_with_confidence_and_text_boxes():
    result = SimpleNamespace(
        json={
            "res": {
                "rec_texts": ["Item", "120.00"],
                "rec_scores": [0.97, 0.88],
                "rec_polys": [
                    [[10, 10], [60, 10], [60, 30], [10, 30]],
                    [[100, 10], [150, 10], [150, 30], [100, 30]],
                ],
            }
        }
    )

    regions = paddleocr_service._regions_from_results([result])

    assert [region["text"] for region in regions] == ["Item", "120.00"]
    assert regions[0]["confidence"] == pytest.approx(0.97)
    assert regions[0]["bbox"] == [[10, 10], [60, 10], [60, 30], [10, 30]]
    assert paddleocr_service._group_regions_into_lines(regions)[0][0] == "Item 120.00"


def test_parser_extracts_items_totals_currency_and_tax_lines():
    raw = paddleocr_service.parse_bill_lines([
        ("Restaurant Name", 0.99),
        ("2 x Veg Burger Rs. 120.00 Rs. 240.00", 0.96),
        ("Sub Total Rs. 240.00", 0.98),
        ("CGST 2.5% Rs. 6.00", 0.97),
        ("SGST 2.5% Rs. 6.00", 0.97),
        ("Packaging fee Rs. 10.00", 0.93),
        ("Discount Rs. 5.00", 0.92),
        ("Grand Total Rs. 257.00", 0.98),
    ])

    assert raw.currency == "INR"
    assert raw.subtotal == 240
    assert raw.gst_amount == 12
    assert raw.other_charges == 10
    assert raw.discount_amount == 5
    assert raw.grand_total == 257
    assert len(raw.items) == 1
    assert raw.items[0].name == "Veg Burger"
    assert raw.items[0].qty == 2
    assert raw.items[0].unit_price == 120
    assert raw.items[0].item_total == 240


def test_parser_does_not_invent_missing_prices_and_warns():
    raw = paddleocr_service.parse_bill_lines([
        ("2 x Unreadable Side", 0.41),
        ("Grand Total 15.00", 0.9),
    ])

    assert len(raw.items) == 1
    assert raw.items[0].unit_price is None
    assert raw.items[0].item_total is None
    assert raw.items[0].confidence <= 0.3
    assert any("price unreadable" in warning.lower() for warning in raw.warnings)
    assert raw.currency == "UNKNOWN"


def test_parser_recognizes_quantity_column_without_an_x_marker():
    raw = paddleocr_service.parse_bill_lines([
        ("Chicken Burger 2 120.00 240.00", 0.96),
    ])

    assert len(raw.items) == 1
    assert raw.items[0].name == "Chicken Burger"
    assert raw.items[0].qty == 2
    assert raw.items[0].unit_price == 120
    assert raw.items[0].item_total == 240


def test_paddle_output_uses_existing_paise_conversion_and_validation(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "paddleocr")
    monkeypatch.setattr(gemini_service, "is_configured", lambda: False)
    gemini_call = AsyncMock(side_effect=AssertionError("Gemini must not be called"))
    monkeypatch.setattr(gemini_service, "extract_bill_items", gemini_call)

    raw = paddleocr_service.parse_bill_lines([
        ("2 x Veg Burger Rs. 120.00 Rs. 240.00", 0.98),
        ("Sub Total Rs. 240.00", 0.98),
        ("CGST 2.5% Rs. 6.00", 0.98),
        ("SGST 2.5% Rs. 6.00", 0.98),
        ("Grand Total Rs. 252.00", 0.98),
    ])
    provider_result = paddleocr_service.PaddleOCRExtraction(
        bill=raw,
        text="2 x Veg Burger Rs. 120.00 Rs. 240.00",
        regions=[{
            "text": "2 x Veg Burger Rs. 120.00 Rs. 240.00",
            "confidence": 0.98,
            "bbox": [[1, 2], [3, 2], [3, 4], [1, 4]],
        }],
    )
    extract_call = AsyncMock(return_value=provider_result)
    monkeypatch.setattr(paddleocr_service, "extract_bill_items", extract_call)
    upload = UploadFile(
        filename="bill.jpg",
        file=BytesIO(b"test image bytes"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    response = asyncio.run(
        ocr_route.extract_bill(upload, hint_currency=CurrencyCode.INR)
    )
    response_items = [item.model_dump() for item in response.items]
    validation = validate_bill(
        items=response_items,
        detected_subtotal_paise=response.detected_subtotal_paise,
        detected_gst_paise=response.detected_gst_paise,
        detected_discount_paise=response.detected_discount_paise,
        detected_service_charge_paise=response.detected_service_charge_paise,
        detected_grand_total_paise=response.detected_grand_total_paise,
        detected_other_charges_paise=response.detected_other_charges_paise,
        detected_round_off_paise=response.detected_round_off_paise,
        currency="INR",
    )

    assert response.ocr_provider == "paddleocr"
    assert response.ocr_text == provider_result.text
    assert response.ocr_regions[0].text == provider_result.regions[0]["text"]
    assert response.items[0].line_total_paise == 24000
    assert response.computed_subtotal_paise == 24000
    assert response.computed_grand_total_paise == 25200
    assert not validation.has_mismatch
    gemini_call.assert_not_awaited()
    extract_call.assert_awaited_once()


def test_gemini_remains_the_default_route_provider(monkeypatch):
    monkeypatch.delenv("OCR_PROVIDER", raising=False)
    monkeypatch.setattr(gemini_service, "is_configured", lambda: True)
    raw = paddleocr_service.parse_bill_lines([
        ("Veg Burger Rs. 120.00", 0.98),
        ("Total Rs. 120.00", 0.98),
    ])
    gemini_call = AsyncMock(return_value=raw)
    paddle_call = AsyncMock(
        side_effect=AssertionError("PaddleOCR must not run for the Gemini default")
    )
    monkeypatch.setattr(gemini_service, "extract_bill_items", gemini_call)
    monkeypatch.setattr(paddleocr_service, "extract_bill_items", paddle_call)
    upload = UploadFile(
        filename="bill.jpg",
        file=BytesIO(b"test image bytes"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    response = asyncio.run(
        ocr_route.extract_bill(upload, hint_currency=CurrencyCode.INR)
    )

    assert response.ocr_provider == "gemini"
    gemini_call.assert_awaited_once()
    paddle_call.assert_not_awaited()


def test_paddle_dependency_error_does_not_fall_back_to_gemini(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "paddleocr")
    monkeypatch.setattr(gemini_service, "extract_bill_items", AsyncMock())
    paddle_call = AsyncMock(
        side_effect=paddleocr_service.PaddleOCRUnavailableError("Install PaddleOCR.")
    )
    monkeypatch.setattr(paddleocr_service, "extract_bill_items", paddle_call)
    upload = UploadFile(
        filename="bill.jpg",
        file=BytesIO(b"test image bytes"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(ocr_route.extract_bill(upload, hint_currency=CurrencyCode.INR))

    assert error.value.status_code == 503
    assert "Install PaddleOCR" in error.value.detail
    paddle_call.assert_awaited_once()

