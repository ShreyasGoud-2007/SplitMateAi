from __future__ import annotations

from services.gemini_service import (
    _coerce_gemini_output,
    build_extracted_items,
)
from routes.ocr import _to_paise
from schemas.bill_schema import ExtractedItemSchema, RawItemSchema
from services.validation_service import validate_bill


def _validate(items: list[dict], **kwargs):
    return validate_bill(
        items=items,
        detected_subtotal_paise=kwargs.get("subtotal"),
        detected_gst_paise=kwargs.get("gst"),
        detected_discount_paise=kwargs.get("discount"),
        detected_service_charge_paise=kwargs.get("service"),
        detected_grand_total_paise=kwargs.get("grand_total"),
        detected_other_charges_paise=kwargs.get("other_charges"),
        detected_round_off_paise=kwargs.get("round_off"),
        currency=kwargs.get("currency", "INR"),
    )


def test_total_only_item_preserves_printed_total_and_infers_unit_price():
    raw = _coerce_gemini_output({
        "items": [{"name": "Shared platter", "qty": 3, "unit_price": None, "item_total": 100.00}],
    })

    [item] = build_extracted_items(raw)

    assert item["qty"] == 3
    assert item["unit_price_paise"] == 3333
    assert item["line_total_paise"] == 10000
    assert item["unit_price_inferred"] is True
    response_item = ExtractedItemSchema(**item)
    warnings = _validate([response_item.model_dump()]).warning_dicts()
    assert not any(warning["code"] == "ITEM_TOTAL_MISMATCH" for warning in warnings)


def test_unit_and_printed_total_mismatch_is_a_warning():
    raw = _coerce_gemini_output({
        "items": [{"name": "Soup", "qty": 2, "unit_price": 50, "item_total": 103}],
    })
    [item] = build_extracted_items(raw)

    result = _validate([ExtractedItemSchema(**item).model_dump()])

    assert any(warning.code == "ITEM_TOTAL_MISMATCH" for warning in result.warnings)
    assert item["unit_price_paise"] == 5000
    assert item["line_total_paise"] == 10300


def test_fractional_quantities_are_preserved():
    raw = _coerce_gemini_output({
        "items": [
            {"name": "Half portion", "qty": 0.5, "unit_price": 12.34, "item_total": 6.17},
            {"name": "One and a half portions", "qty": 1.5, "unit_price": 12.34, "item_total": 18.51},
        ],
    })

    items = build_extracted_items(raw)

    assert [item["qty"] for item in items] == [0.5, 1.5]
    assert [ExtractedItemSchema(**item).qty for item in items] == [0.5, 1.5]


def test_negative_discount_is_normalized_to_positive_paise():
    assert _to_paise(-12.50, absolute=True) == 1250


def test_half_paise_rounding_is_consistent_for_currency_and_fractional_items():
    assert _to_paise(0.005) == 1

    result = _validate([{
        "name": "Half-paise unit",
        "qty": 0.5,
        "unit_price_paise": 1,
        "line_total_paise": 1,
        "unit_price_inferred": False,
    }])

    assert not any(warning.code == "ITEM_TOTAL_MISMATCH" for warning in result.warnings)


def test_item_with_both_prices_unreadable_is_kept_with_warning():
    raw = _coerce_gemini_output({
        "items": [{"name": "Unpriced side", "qty": 1, "unit_price": None, "item_total": None}],
    })

    [item] = build_extracted_items(raw)

    assert item["unit_price_paise"] == 0
    assert item["line_total_paise"] == 0
    assert item["confidence"] <= 0.3
    assert "price unreadable" in item["gemini_warnings"][0].lower()


def test_gemini_response_excludes_bill_totals_tax_and_cancelled_lines():
    raw = _coerce_gemini_output({
        "items": [
            {"name": "Chicken Biryani", "qty": 1, "unit_price": 180, "item_total": 180},
            {"name": "Sub Total", "qty": 1, "unit_price": None, "item_total": 180},
            {"name": "Total", "qty": 1, "unit_price": None, "item_total": 180},
            {"name": "CGST", "qty": 1, "unit_price": None, "item_total": 4.5},
            {"name": "Grand Total", "qty": 1, "unit_price": None, "item_total": 189},
            {"name": "Delivery charge", "qty": 1, "unit_price": None, "item_total": 4.5},
            {"name": "Other charge", "qty": 1, "unit_price": None, "item_total": 4.5},
            {"name": "Cancelled Paneer", "qty": 1, "unit_price": 75, "item_total": 75},
        ],
        "subtotal": "₹180.00",
        "gst_amount": "Rs. 9.00",
        "grand_total": "189.00",
    })

    items = build_extracted_items(raw)

    assert [item["name"] for item in items] == ["Chicken Biryani"]
    assert raw.subtotal == 180
    assert raw.gst_amount == 9
    assert raw.grand_total == 189


def test_computed_subtotal_equals_returned_items_line_totals():
    raw = _coerce_gemini_output({
        "items": [
            {"name": "Rice", "qty": 1.5, "unit_price": 40, "item_total": 60},
            {"name": "Tea", "qty": 2, "unit_price": 10, "item_total": 20},
        ],
    })
    response_items = [
        ExtractedItemSchema(**item).model_dump()
        for item in build_extracted_items(raw)
    ]

    result = _validate(response_items)

    assert result.computed_subtotal_paise == sum(
        item["line_total_paise"] for item in response_items
    )


def test_indian_currency_strings_are_parsed_as_major_units():
    raw = _coerce_gemini_output({
        "items": [{"name": "Meal", "qty": 1, "unit_price": "Rs. 1,250.00", "item_total": "₹1,250.00"}],
    })

    [item] = build_extracted_items(raw)

    assert item["unit_price_paise"] == 125000
    assert item["line_total_paise"] == 125000


def test_invalid_item_is_retained_with_a_warning():
    raw = _coerce_gemini_output({"items": [None]})

    [item] = build_extracted_items(raw)

    assert item["name"] == "Unreadable item 1"
    assert item["gemini_warnings"]

