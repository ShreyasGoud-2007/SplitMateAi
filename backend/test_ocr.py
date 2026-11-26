"""
test_ocr.py
Quick end-to-end test for the OCR endpoint.
Builds a synthetic Indian restaurant bill image and sends it to the running server.

Usage:
    cd backend
    python test_ocr.py
"""
import io
import json
import sys
import requests
from PIL import Image, ImageDraw


def build_bill_image() -> bytes:
    """Create a synthetic JPEG receipt image readable by Gemini Vision."""
    img = Image.new("RGB", (480, 680), color="white")
    draw = ImageDraw.Draw(img)

    lines = [
        "        SPICE GARDEN RESTAURANT",
        "        123 MG Road, Bangalore",
        "        GSTIN: 29ABCDE1234F1Z5",
        "",
        "=" * 48,
        "BILL NO: 1042          DATE: 24/11/2026",
        "=" * 48,
        "Item                      Qty  Price    Amt",
        "-" * 48,
        "Chicken Biryani            1   180.00  180.00",
        "Paneer 65                  2    75.00  150.00",
        "Masala Dosa                1    80.00   80.00",
        "Thums Up                   2    40.00   80.00",
        "Garlic Naan                3    35.00  105.00",
        "-" * 48,
        "Sub Total                              595.00",
        "GST @ 5%                                29.75",
        "-" * 48,
        "GRAND TOTAL                      Rs. 624.75",
        "=" * 48,
        "         Thank you! Visit again!",
        "         Currency: INR",
    ]

    y = 20
    for line in lines:
        draw.text((20, y), line, fill="black")
        y += 22

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    buf.seek(0)
    return buf.read()


def run_test(base_url: str = "http://localhost:8000") -> None:
    # Health check
    health = requests.get(f"{base_url}/health", timeout=5)
    print(f"Health: HTTP {health.status_code}  {health.json()}")
    assert health.status_code == 200, "Server not running!"

    # OCR test
    image_bytes = build_bill_image()
    print(f"\nSending synthetic bill image ({len(image_bytes):,} bytes) to OCR endpoint...")

    resp = requests.post(
        f"{base_url}/api/ocr/extract",
        files={"file": ("bill.jpg", image_bytes, "image/jpeg")},
        data={"hint_currency": "INR"},
        timeout=300,
    )

    print(f"HTTP {resp.status_code}")

    if resp.status_code != 200:
        print("ERROR:", resp.text[:800])
        sys.exit(1)

    data = resp.json()

    print(f"Restaurant:         {data['restaurant_name']}")
    print(f"Currency:           {data['detected_currency']}")
    print(f"Currency mismatch:  {data['currency_mismatch']}")
    print(f"Confidence:         {data['overall_confidence']:.2f}")
    print(f"Items found:        {len(data['items'])}")
    print()

    for item in data["items"]:
        up = item["unit_price_paise"] / 100
        lt = item["line_total_paise"] / 100
        conf = item["confidence"]
        print(
            f"  [{conf:.2f}] {item['name']:<28}  "
            f"qty={item['qty']}  "
            f"unit=Rs.{up:>7.2f}  "
            f"total=Rs.{lt:>7.2f}"
        )

    print()
    sub_comp = data["computed_subtotal_paise"] / 100
    sub_det  = (data["detected_subtotal_paise"] or 0) / 100
    gst_det  = (data["detected_gst_paise"] or 0) / 100
    grand    = (data["detected_grand_total_paise"] or 0) / 100

    print(f"Computed subtotal:  Rs.{sub_comp:>8.2f}")
    print(f"Detected subtotal:  Rs.{sub_det:>8.2f}")
    print(f"Detected GST:       Rs.{gst_det:>8.2f}")
    print(f"Detected grand:     Rs.{grand:>8.2f}")
    print(f"Has mismatch:       {data['has_mismatch']}")
    print(f"Validation warnings: {len(data['validation_warnings'])}")
    for w in data["validation_warnings"]:
        print(f"  [{w['code']}] {w['message']}")

    if data["gemini_warnings"]:
        print(f"\nGemini warnings ({len(data['gemini_warnings'])}):")
        for w in data["gemini_warnings"]:
            print(f"  - {w}")

    print(f"\nMessage: {data['message']}")
    print("\nTest PASSED.")


if __name__ == "__main__":
    run_test()
