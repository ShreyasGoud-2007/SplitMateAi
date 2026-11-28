from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import threading
from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from statistics import mean
from typing import Any, Optional

from PIL import Image, UnidentifiedImageError

from schemas.bill_schema import RawOCRBill, RawItemSchema, parse_currency_amount

logger = logging.getLogger(__name__)

_DETECTION_MODEL = "PP-OCRv5_mobile_det"
_RECOGNITION_MODEL = "PP-OCRv5_mobile_rec"
_CPU_THREADS = 2

_ENGINE: Any = None
_ENGINE_LOCK = threading.Lock()
_INFERENCE_LOCK = threading.Lock()

_MONEY_TOKEN = re.compile(
    r"(?<![\w])(?P<amount>(?:(?:₹|[$€£])\s*|(?:Rs\.?|INR|USD|EUR|GBP)\s*)?"
    r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\w])",
    re.IGNORECASE,
)
_CURRENCY_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("INR", re.compile(r"₹|\b(?:INR|Rs\.?)(?=\s|$|\d)", re.IGNORECASE)),
    ("USD", re.compile(r"\$|\bUSD\b", re.IGNORECASE)),
    ("EUR", re.compile(r"€|\bEUR\b", re.IGNORECASE)),
    ("GBP", re.compile(r"£|\bGBP\b", re.IGNORECASE)),
)
_METADATA_LINE = re.compile(
    r"\b(?:invoice|receipt|bill\s*(?:no|number)|date|time|phone|mobile|"
    r"gstin|table|cashier|server|thank\s+you)\b",
    re.IGNORECASE,
)
_NON_ITEM_CATEGORIES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "subtotal",
        re.compile(r"^\s*(?:sub[\s-]*total|items?\s+(?:sub[\s-]*)?total)\b", re.I),
    ),
    ("round_off", re.compile(r"^\s*round(?:[\s-]*off|ing)\b", re.I)),
    ("discount_amount", re.compile(r"^\s*(?:discount|coupon|offer)\b", re.I)),
    ("service_charge", re.compile(r"^\s*service[\s-]*charge\b", re.I)),
    (
        "other_charges",
        re.compile(
            r"^\s*(?:delivery|packaging|other[\s-]*charge|convenience\s+fee|"
            r"platform\s+fee)\b",
            re.I,
        ),
    ),
    ("tax", re.compile(r"^\s*(?:cgst|sgst|igst|gst|vat|tax)\b", re.I)),
    (
        "grand_total",
        re.compile(
            r"^\s*(?:grand[\s-]*total|net\s+(?:total|payable)|amount\s+due|"
            r"bill\s+amount|total\s+due|total)\b",
            re.I,
        ),
    ),
)


class PaddleOCRUnavailableError(RuntimeError):
    """Raised when the optional PaddleOCR runtime is not installed or loadable."""


class PaddleOCRProcessingError(RuntimeError):
    """Raised when PaddleOCR cannot read the supplied image."""


@dataclass(frozen=True)
class PaddleOCRExtraction:
    bill: RawOCRBill
    text: str
    regions: list[dict[str, Any]]


def _get_engine() -> Any:
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE

    with _ENGINE_LOCK:
        if _ENGINE is not None:
            return _ENGINE
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise PaddleOCRUnavailableError(
                "PaddleOCR is selected but its optional CPU dependencies are not installed. "
                "Follow the PaddleOCR installation steps in README.md."
            ) from exc

        try:
            _ENGINE = PaddleOCR(
                text_detection_model_name=_DETECTION_MODEL,
                text_recognition_model_name=_RECOGNITION_MODEL,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                device="cpu",
                engine="paddle",
                engine_config={"paddle_static": {"cpu_threads": _CPU_THREADS}},
            )
        except Exception as exc:
            raise PaddleOCRUnavailableError(
                "PaddleOCR could not initialize its CPU models. Check the PaddleOCR "
                "installation and model-download access."
            ) from exc
        return _ENGINE


def _to_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, (list, tuple)):
        return list(value)
    return []


def _normalize_box(box: Any) -> list[list[int]]:
    coordinates = _to_list(box)
    if len(coordinates) == 4 and all(
        isinstance(point, (int, float)) for point in coordinates
    ):
        left, top, right, bottom = (int(round(float(value))) for value in coordinates)
        return [[left, top], [right, top], [right, bottom], [left, bottom]]

    points: list[list[int]] = []
    for point in coordinates:
        xy = _to_list(point)
        if len(xy) < 2:
            return []
        try:
            points.append([int(round(float(xy[0]))), int(round(float(xy[1])))])
        except (TypeError, ValueError, OverflowError):
            return []
    return points


def _result_payload(result: Any) -> dict[str, Any]:
    payload = result
    if not isinstance(payload, dict):
        payload = getattr(result, "json", None)
        if callable(payload):
            payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise PaddleOCRProcessingError("PaddleOCR returned an unsupported result format.")
    nested = payload.get("res")
    return nested if isinstance(nested, dict) else payload


def _regions_from_results(results: Any) -> list[dict[str, Any]]:
    pages = results if isinstance(results, (list, tuple)) else [results]
    regions: list[dict[str, Any]] = []

    for page in pages:
        payload = _result_payload(page)
        texts = _to_list(payload.get("rec_texts"))
        scores = _to_list(payload.get("rec_scores"))
        boxes = _to_list(payload.get("rec_polys")) or _to_list(payload.get("dt_polys"))
        if not boxes:
            boxes = _to_list(payload.get("rec_boxes"))

        for index, value in enumerate(texts):
            text = str(value).strip()
            if not text:
                continue
            box = _normalize_box(boxes[index]) if index < len(boxes) else []
            score: Optional[float] = None
            if index < len(scores):
                try:
                    candidate = float(scores[index])
                    if math.isfinite(candidate):
                        score = min(1.0, max(0.0, candidate))
                except (TypeError, ValueError):
                    pass
            regions.append({"text": text, "confidence": score, "bbox": box})

    regions.sort(key=lambda region: _region_center(region)[1])
    return regions


def _region_center(region: dict[str, Any]) -> tuple[float, float, float]:
    points = region.get("bbox") or []
    if not points:
        return 0.0, 0.0, 0.0
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return sum(xs) / len(xs), sum(ys) / len(ys), max(ys) - min(ys)


def _group_regions_into_lines(regions: list[dict[str, Any]]) -> list[tuple[str, Optional[float]]]:
    ordered = sorted(regions, key=lambda region: (_region_center(region)[1], _region_center(region)[0]))
    groups: list[list[dict[str, Any]]] = []

    for region in ordered:
        _, center_y, height = _region_center(region)
        if not groups:
            groups.append([region])
            continue
        group = groups[-1]
        group_center_y = mean(_region_center(entry)[1] for entry in group)
        group_height = max((_region_center(entry)[2] for entry in group), default=0.0)
        if abs(center_y - group_center_y) <= max(10.0, 0.55 * max(height, group_height)):
            group.append(region)
        else:
            groups.append([region])

    lines: list[tuple[str, Optional[float]]] = []
    for group in groups:
        group.sort(key=lambda region: _region_center(region)[0])
        line_text = " ".join(region["text"] for region in group).strip()
        scores = [
            region["confidence"]
            for region in group
            if region.get("confidence") is not None
        ]
        lines.append((line_text, mean(scores) if scores else None))
    return lines


def _extract_quantity(line: str) -> tuple[str, float, bool]:
    patterns = (
        re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$", re.I),
        re.compile(r"^\s*(.+?)\s+[x×]\s*(\d+(?:\.\d+)?)(?=\s|$)(.*)$", re.I),
        re.compile(r"^\s*(\d+(?:\.\d+)?)\s+(?=[^\d])(.+)$"),
    )
    for index, pattern in enumerate(patterns):
        match = pattern.match(line)
        if not match:
            continue
        quantity = float(match.group(1 if index != 1 else 2))
        if not math.isfinite(quantity) or quantity <= 0 or quantity > 100:
            continue
        if index == 0:
            return match.group(2), quantity, True
        if index == 1:
            return f"{match.group(1)} {match.group(3)}", quantity, True
        return match.group(2), quantity, True
    return line, 1.0, False


def _line_category(line: str) -> Optional[str]:
    for category, pattern in _NON_ITEM_CATEGORIES:
        if pattern.search(line):
            return category
    return None


def _amount_tokens(line: str) -> list[tuple[re.Match[str], float]]:
    tokens: list[tuple[re.Match[str], float]] = []
    for match in _MONEY_TOKEN.finditer(line):
        if line[match.end():].lstrip().startswith("%"):
            continue
        value = parse_currency_amount(match.group("amount"))
        if value is not None and abs(value) <= 1_000_000:
            tokens.append((match, value))
    return tokens


def _currency_from_text(text: str) -> tuple[str, bool]:
    matches = [
        currency for currency, pattern in _CURRENCY_MARKERS if pattern.search(text)
    ]
    if len(matches) == 1:
        return matches[0], False
    if len(matches) > 1:
        return "UNKNOWN", True
    return "UNKNOWN", False


def parse_bill_lines(
    lines: list[tuple[str, Optional[float]]],
) -> RawOCRBill:
    """Parse OCR text lines into the existing raw bill schema without guessing amounts."""
    full_text = "\n".join(line for line, _ in lines)
    currency, conflicting_currencies = _currency_from_text(full_text)
    warnings: list[str] = []
    if currency == "UNKNOWN":
        if conflicting_currencies:
            warnings.append("Multiple currency markers were detected; confirm the bill currency.")
        else:
            warnings.append("No currency marker was detected; confirm the bill currency.")

    bill_totals: dict[str, list[float]] = {
        "subtotal": [],
        "gst_amount": [],
        "discount_amount": [],
        "service_charge": [],
        "other_charges": [],
        "round_off": [],
        "grand_total": [],
    }
    items: list[RawItemSchema] = []
    confidence_scores = [
        score for _, score in lines if score is not None and math.isfinite(score)
    ]

    for line_number, (source_line, line_confidence) in enumerate(lines, start=1):
        line = source_line.strip()
        if not line:
            continue
        category = _line_category(line)
        tokens = _amount_tokens(line)
        if category:
            if tokens:
                amount = abs(tokens[-1][1]) if category == "discount_amount" else tokens[-1][1]
                if category == "tax":
                    bill_totals["gst_amount"].append(abs(amount))
                else:
                    bill_totals[category].append(abs(amount) if category == "discount" else amount)
            else:
                warnings.append(f"Could not read the amount on bill line {line_number} ({category.replace('_', ' ')}).")
            continue

        if _METADATA_LINE.search(line):
            continue

        item_line, qty, qty_detected = _extract_quantity(line)
        tokens = _amount_tokens(item_line)
        if not qty_detected and len(tokens) >= 3:
            qty_match, qty_candidate = tokens[-3]
            if qty_candidate.is_integer() and 0 < qty_candidate <= 100:
                qty = qty_candidate
                qty_detected = True
                item_line = (
                    item_line[:qty_match.start()]
                    + item_line[qty_match.end():]
                )
                tokens = _amount_tokens(item_line)

        item_name = _MONEY_TOKEN.sub(" ", item_line)
        item_name = re.sub(
            r"\b(?:qty|quantity|rate|price|amount|rs|inr|usd|eur|gbp)\b",
            " ",
            item_name,
            flags=re.I,
        )
        item_name = re.sub(r"[\s|,:;#-]+", " ", item_name).strip()
        item_name = re.sub(r"^(?:qty|quantity|x)\s+", "", item_name, flags=re.I)
        if not item_name or not re.search(r"[A-Za-z\u00c0-\u024f]", item_name):
            continue

        has_amount_evidence = bool(tokens)
        if not has_amount_evidence and not qty_detected:
            continue

        item_total: Optional[float] = None
        unit_price: Optional[float] = None
        if tokens:
            item_total = abs(tokens[-1][1])
            if len(tokens) >= 2:
                unit_price = abs(tokens[-2][1])
        item_warnings: list[str] = []
        confidence = line_confidence if line_confidence is not None else 0.3
        if not qty_detected:
            item_warnings.append(
                f"Item '{item_name}' quantity was not detected; defaulted to 1 for review."
            )
            confidence = min(confidence, 0.4)
        if unit_price is None and item_total is not None:
            item_warnings.append(
                f"Item '{item_name}' has no separate unit price; inferred from its line total."
            )
        if item_total is None and unit_price is None:
            item_warnings.append(f"Item '{item_name}' price unreadable.")
            confidence = min(confidence, 0.3)
        if line_confidence is not None and line_confidence < 0.5:
            item_warnings.append(f"OCR confidence is low for item '{item_name}'.")
        warnings.extend(item_warnings)

        items.append(
            RawItemSchema(
                name=item_name,
                qty=qty,
                unit_price=unit_price,
                item_total=item_total,
                confidence=min(1.0, max(0.0, confidence)),
            )
        )

    if not items:
        warnings.append("No purchasable line items could be parsed from the OCR text.")

    def amount_or_none(field: str) -> Optional[float]:
        values = bill_totals[field]
        if not values:
            return None
        return float(sum((Decimal(str(value)) for value in values), Decimal("0")))

    overall_confidence = mean(confidence_scores) if confidence_scores else 0.25
    return RawOCRBill(
        items=items,
        subtotal=amount_or_none("subtotal"),
        gst_amount=amount_or_none("gst_amount"),
        discount_amount=amount_or_none("discount_amount"),
        service_charge=amount_or_none("service_charge"),
        other_charges=amount_or_none("other_charges"),
        round_off=amount_or_none("round_off"),
        grand_total=amount_or_none("grand_total"),
        currency=currency,
        overall_confidence=overall_confidence,
        warnings=list(dict.fromkeys(warnings)),
    )


def _run_ocr(image_bytes: bytes) -> list[dict[str, Any]]:
    try:
        import numpy as np
    except ImportError as exc:
        raise PaddleOCRUnavailableError(
            "PaddleOCR requires its optional CPU dependencies. Follow the PaddleOCR "
            "installation steps in README.md."
        ) from exc

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            image_array = np.asarray(image.convert("RGB"))
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise PaddleOCRProcessingError("PaddleOCR could not decode the uploaded image.") from exc

    engine = _get_engine()
    try:
        with _INFERENCE_LOCK:
            results = engine.predict(image_array)
        return _regions_from_results(results)
    except PaddleOCRProcessingError:
        raise
    except Exception as exc:
        logger.exception("PaddleOCR inference failed.")
        raise PaddleOCRProcessingError(
            "PaddleOCR failed while processing the uploaded image."
        ) from exc


async def extract_bill_items(image_bytes: bytes) -> PaddleOCRExtraction:
    """Run CPU PaddleOCR and parse its detected text into the shared bill schema."""
    regions = await asyncio.to_thread(_run_ocr, image_bytes)
    lines = _group_regions_into_lines(regions)
    text = "\n".join(line for line, _ in lines)
    bill = parse_bill_lines(lines)
    return PaddleOCRExtraction(bill=bill, text=text, regions=regions)
