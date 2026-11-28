/**
 * Core data types for SplitMate AI bill extraction and splitting.
 *
 * MONETARY STORAGE CONVENTION
 * ───────────────────────────
 * All prices are stored as INTEGER PAISE (1 rupee = 100 paise).
 * The fields `unitPricePaise` and `detectedSubtotalPaise` are authoritative.
 * The legacy `unitPrice` (rupees) is kept for backwards compatibility and UI
 * convenience but is always derived from paise on the way in.
 */

import {
    DEFAULT_TAX_RATE,
    applyRatePaise,
    fromPaise,
    lineTotalPaise,
    sumPaise,
    toPaise,
} from '@/utils/currency';
import { createId } from '@/utils/ids';
import { normalizeBill } from '@/utils/billNormalization';
import type { BillCurrency } from '@/types/splitSession';

export type BillSource = 'ocr' | 'manual' | 'demo';

export interface BillImageMetadata {
  uri?: string;
  originalFileName?: string;
  mimeType?: string;
  source?: 'camera' | 'gallery' | 'imported' | 'external';
  storagePath?: string;
  uploadedAt?: string;
}

export interface BillMetadata {
  taxIsEstimated?: boolean;
  validationWarnings?: string[];
  [key: string]: unknown;
}

// ── Item ──────────────────────────────────────────────────────────────────────

/** A single line item on a restaurant bill. */
export interface BillItem {
  id: string;
  name: string;
  qty: number;
  /** Unit price in PAISE (integer). Primary storage. */
  unitPricePaise: number;
  /** Canonical line total in paise; OCR preserves the printed line total. */
  lineTotalPaise: number;
  /**
   * Unit price in rupees (float convenience accessor).
   * Always equals unitPricePaise / 100.
   */
  unitPrice: number;
  /** 0–1 confidence score from AI extraction. Absent for manually entered items. */
  confidence?: number;
}

// ── Bill ──────────────────────────────────────────────────────────────────────

/**
 * Full structured result returned after bill extraction.
 * When OCR/AI is not integrated, this is populated with demo data.
 */
export interface CanonicalBill {
  id: string;
  source: BillSource;
  currency: BillCurrency;
  imageUri?: string;
  imageMetadata?: BillImageMetadata;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  items: BillItem[];
  createdAt: string;
  metadata?: BillMetadata;
  /**
   * Subtotal printed on the bill as detected by OCR, in PAISE.
   * Null when the printed subtotal could not be read.
   */
  detectedSubtotalPaise: number | null;
  /**
   * @deprecated Use detectedSubtotalPaise.
   * Kept so old code that reads detectedSubtotal doesn't break immediately.
   */
  detectedSubtotal: number | null;
  /** Currency code detected from the bill. Defaults to "INR". */
  detectedCurrency: string;
  /** True when OCR detected a different currency than the requested hint. */
  currencyMismatch?: boolean;
  /** True when items were populated from demo data, not real OCR. */
  isDemoData: boolean;

  // ── Real OCR fields (populated by the backend API) ────────────────────────

  /** Restaurant name read from the bill, if visible. */
  restaurantName?: string | null;
  /** GST amount printed on the bill, in paise. */
  detectedGstPaise?: number | null;
  /** Discount amount printed on the bill, in paise. */
  detectedDiscountPaise?: number | null;
  /** Service charge / tip printed on the bill, in paise. */
  detectedServiceChargePaise?: number | null;
  /** Packaging, delivery, and other bill-level charges, in paise. */
  detectedOtherChargesPaise?: number | null;
  /** Printed bill rounding adjustment, in paise. */
  detectedRoundOffPaise?: number | null;
  /** Grand total printed on the bill, in paise. */
  detectedGrandTotalPaise?: number | null;
  /** Subtotal computed by the backend from extracted items, in paise. */
  computedSubtotalPaise?: number;
  /** Grand total computed by the backend, in paise. */
  computedGrandTotalPaise?: number;
  /** Validation warnings from the backend arithmetic checks. */
  validationWarnings?: BillValidationWarning[];
  /** True when the backend detected a subtotal mismatch. */
  hasMismatch?: boolean;
  /** Overall OCR confidence score [0–1]. */
  overallConfidence?: number;
  /** Warnings produced by Gemini (e.g. unreadable fields). */
  geminiWarnings?: string[];
}

/** Backwards-compatible name used by the existing screens and store. */
export type ExtractedBill = CanonicalBill;

/** A validation warning returned by the backend. */
export interface BillValidationWarning {
  code: string;
  message: string;
  expected_paise?: number | null;
  actual_paise?: number | null;
  difference_paise?: number | null;
}

// ── Tip & tax ─────────────────────────────────────────────────────────────────

export type TipOption = 0 | 5 | 10 | 15 | 20;
export const TIP_OPTIONS: TipOption[] = [0, 5, 10, 15, 20];

/** GST rate for most Indian restaurants (5%). */
export { DEFAULT_TAX_RATE };

// ── Demo data ─────────────────────────────────────────────────────────────────

/**
 * Fallback demo items — Indian restaurant menu.
 * Used ONLY when real OCR extraction is unavailable.
 */
export const DEMO_BILL_ITEMS: BillItem[] = [
  makeBillItem('d1', 'Chicken Biryani', 1, 180, 0.95),
  makeBillItem('d2', 'Veg Fried Rice',  1, 120, 0.93),
  makeBillItem('d3', 'Paneer 65',       1, 150, 0.91),
  makeBillItem('d4', 'Masala Dosa',     2,  80, 0.97),
  makeBillItem('d5', 'Chicken 65',      1, 160, 0.89),
  makeBillItem('d6', 'Thums Up',        3,  40, 0.98),
];

// ── Factories ─────────────────────────────────────────────────────────────────

/** Create a BillItem from rupee price (converts to paise internally). */
export function makeBillItem(
  id: string,
  name: string,
  qty: number,
  unitPriceRupees: number,
  confidence?: number,
): BillItem {
  const unitPricePaise = toPaise(unitPriceRupees);
  return {
    id,
    name,
    qty,
    unitPricePaise,
    lineTotalPaise: lineTotalPaise(unitPricePaise, qty),
    unitPrice: fromPaise(unitPricePaise),
    confidence,
  };
}

/** Build a fresh canonical demo bill. The image is optional. */
export function buildDemoBill(imageUri?: string): ExtractedBill {
  const subtotalPaise = computeSubtotalPaise(DEMO_BILL_ITEMS);
  const taxPaise = computeGSTPaise(subtotalPaise);
  return normalizeBill({
    id: createId(),
    source: 'demo',
    currency: 'INR',
    imageUri,
    imageMetadata: imageUri ? { uri: imageUri, source: 'gallery' } : undefined,
    items: DEMO_BILL_ITEMS.map(item => ({ ...item, id: createId() })),
    detectedSubtotalPaise: null,
    detectedSubtotal: null,
    detectedCurrency: 'INR',
    detectedGstPaise: null,
    detectedGrandTotalPaise: null,
    taxPaise,
    subtotalPaise,
    totalPaise: subtotalPaise + taxPaise,
    metadata: { taxIsEstimated: true },
    isDemoData: true,
  });
}

// ── Computation helpers ───────────────────────────────────────────────────────

/** Compute subtotal in PAISE from an array of BillItems. */
export function computeSubtotalPaise(items: BillItem[]): number {
  return sumPaise(items.map(i => i.lineTotalPaise));
}

/**
 * Compute subtotal in RUPEES (float).
 * @deprecated Prefer computeSubtotalPaise for arithmetic; convert at render.
 */
export function computeSubtotal(items: BillItem[]): number {
  return fromPaise(computeSubtotalPaise(items));
}

/** Compute GST amount in paise given subtotal paise. */
export function computeGSTPaise(subtotalPaise: number): number {
  return applyRatePaise(subtotalPaise, DEFAULT_TAX_RATE);
}

/** Compute tip amount in paise given subtotal paise and tip percentage. */
export function computeTipPaise(subtotalPaise: number, tipPct: TipOption): number {
  if (tipPct === 0) return 0;
  return applyRatePaise(subtotalPaise, tipPct / 100);
}

/** Compute grand total in paise. */
export function computeTotalPaise(
  subtotalPaise: number,
  gstPaise: number,
  tipPaise: number,
): number {
  return subtotalPaise + gstPaise + tipPaise;
}

/** Generate a unique id for manually added items. */
export function generateItemId(): string {
  return createId();
}

/** Create a blank item ready for the Add modal. */
export function makeBlankItem(): BillItem {
  return makeBillItem(generateItemId(), '', 1, 0);
}
