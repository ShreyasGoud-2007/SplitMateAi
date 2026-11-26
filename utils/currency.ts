/**
 * Currency formatting utilities for SplitMate AI.
 * Default currency: INR (Indian Rupees), locale: en-IN.
 *
 * PAISE ARITHMETIC
 * ────────────────
 * To avoid floating-point rounding errors all monetary values are stored and
 * computed as integer paise (1 rupee = 100 paise).  Convert at the UI
 * boundary only — parse user input → paise, format paise → ₹ string.
 */

export const DEFAULT_CURRENCY = 'INR' as const;
export const DEFAULT_LOCALE   = 'en-IN' as const;
export const DEFAULT_TAX_RATE = 0.05;

// ── Formatters (created once, reused) ────────────────────────────────────────

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_COMPACT_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ── Rupee-level helpers ───────────────────────────────────────────────────────

/**
 * Format a rupee amount (number) as an INR string.
 * Example: formatINR(1250) → "₹1,250.00"
 */
export function formatINR(rupees: number): string {
  return INR_FORMATTER.format(rupees);
}

/**
 * Format a rupee amount without decimals when the value is a whole number.
 * Example: formatINRCompact(1250) → "₹1,250"
 *          formatINRCompact(1250.5) → "₹1,250.50"
 */
export function formatINRCompact(rupees: number): string {
  return rupees % 1 === 0
    ? INR_COMPACT_FORMATTER.format(rupees)
    : INR_FORMATTER.format(rupees);
}

// ── Paise helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a rupee float to integer paise, rounding to nearest paisa.
 * Example: toPaise(180.5) → 18050
 */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Convert integer paise back to a rupee float.
 * Example: fromPaise(18050) → 180.5
 */
export function fromPaise(paise: number): number {
  return paise / 100;
}

/**
 * Format integer paise as an INR currency string.
 * Example: formatPaise(18000) → "₹180.00"
 */
export function formatPaise(paise: number): string {
  return INR_FORMATTER.format(paise / 100);
}

/**
 * Compute the line total for one bill item in paise.
 * Uses integer arithmetic to avoid floating-point drift.
 */
export function lineTotalPaise(unitPricePaise: number, qty: number): number {
  return Math.round(unitPricePaise * qty);
}

/**
 * Sum an array of paise values.
 */
export function sumPaise(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Apply a percentage to a paise amount and return paise, rounded.
 * Example: applyRatePaise(73000, 0.05) → 3650
 */
export function applyRatePaise(paise: number, rate: number): number {
  return Math.round(paise * rate);
}

// ── Input parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a user-entered price string into rupees (float).
 * Strips ₹, $, commas, and surrounding whitespace.
 * Returns NaN if the string cannot be parsed.
 */
export function parseRupees(raw: string): number {
  const cleaned = raw.replace(/[₹$,\s]/g, '');
  return parseFloat(cleaned);
}

/** @deprecated Use parseRupees */
export const parseAmount = parseRupees;
