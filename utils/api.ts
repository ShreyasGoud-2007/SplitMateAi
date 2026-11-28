/**
 * utils/api.ts
 * API service for SplitMate AI — OCR bill extraction.
 *
 * Reads EXPO_PUBLIC_API_BASE_URL from the root .env file.
 * Uploads images via multipart/form-data.  React Native's fetch polyfill
 * handles the boundary automatically — never set Content-Type manually.
 *
 * OCR provider credentials stay on the backend and are NEVER sent to the client.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import type { BillCurrency } from '@/types/splitSession';
import { DEFAULT_CURRENCY } from '@/utils/currency';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Backend base URL.  Read from EXPO_PUBLIC_API_BASE_URL in the root .env.
 * Falls back to localhost when the variable is missing.
 */
const API_BASE_URL: string =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim() || 'http://localhost:8000';

// Log at module load so the URL is visible as soon as the app starts
console.log('[api] Module loaded. API_BASE_URL:', API_BASE_URL);
console.log('[api] EXPO_PUBLIC_API_BASE_URL env value:', process.env.EXPO_PUBLIC_API_BASE_URL ?? '(undefined)');

/** Must exceed the backend's 100-second processing deadline. */
const OCR_TIMEOUT_MS = 130_000;

/** Health-check timeout. */
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_UPLOAD_EDGE = 2_000;
const JPEG_QUALITY = 0.8;

// ── Types (mirror the FastAPI Pydantic response schema exactly) ───────────────

export interface OCRItem {
  id: string;
  name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  unit_price_inferred?: boolean;
  confidence: number;
}

export interface OCRValidationWarning {
  code: string;
  message: string;
  expected_paise?: number | null;
  actual_paise?: number | null;
  difference_paise?: number | null;
}

export interface OCRExtractResponse {
  success: boolean;
  is_demo_data: boolean;
  ocr_provider: 'gemini' | 'paddleocr';
  ocr_text: string | null;
  ocr_regions: {
    text: string;
    confidence: number | null;
    bbox: number[][];
  }[];
  restaurant_name: string | null;
  detected_currency: string;
  currency_mismatch: boolean;
  items: OCRItem[];
  detected_subtotal_paise: number | null;
  detected_gst_paise: number | null;
  detected_discount_paise: number | null;
  detected_service_charge_paise: number | null;
  detected_other_charges_paise: number | null;
  detected_round_off_paise: number | null;
  detected_grand_total_paise: number | null;
  computed_subtotal_paise: number;
  computed_grand_total_paise: number;
  validation_warnings: OCRValidationWarning[];
  has_mismatch: boolean;
  overall_confidence: number;
  provider_warnings: string[];
  gemini_warnings: string[];
  message: string;
}

// ── Error class ────────────────────────────────────────────────────────────────

export class OCRError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'OCRError';
  }
}

// ── MIME / filename helpers ───────────────────────────────────────────────────

/**
 * Derive the best MIME type to use for the FormData part.
 * We prefer the value reported by expo-image-picker (asset.mimeType) which
 * Android fills in correctly even for extension-less cache URIs.
 *
 * Falls back to guessing from the URI extension, then to image/jpeg.
 */
export function resolveMimeType(
  pickerMime: string | null | undefined,
  uri: string,
): string {
  if (pickerMime && pickerMime.startsWith('image/')) return pickerMime;

  const lower = uri.toLowerCase().split('?')[0]; // strip query string
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif'))  return 'image/gif';

  return 'image/jpeg'; // safe default for camera captures
}

/**
 * Derive the best filename for the FormData part.
 * Uses the picker-supplied filename when available, otherwise
 * builds one from the MIME type.
 */
export function resolveFileName(
  pickerFileName: string | null | undefined,
  mimeType: string,
): string {
  if (pickerFileName && pickerFileName.trim()) return pickerFileName.trim();

  const ext = mimeType === 'image/png'  ? 'png'
            : mimeType === 'image/webp' ? 'webp'
            : 'jpg';
  return `bill.${ext}`;
}

// ── Main upload function ───────────────────────────────────────────────────────

/**
 * Upload a bill image to the backend for the configured OCR provider.
 *
 * @param imageUri   Local `file://` URI from expo-image-picker.
 * @param mimeType   MIME type from ImagePickerAsset.mimeType (preferred).
 * @param fileName   Filename from ImagePickerAsset.fileName (preferred).
 *
 * @returns   Parsed OCR response with items, totals, and validation warnings.
 * @throws    OCRError for all failure modes — network, timeout, HTTP errors.
 *
 * Security: OCR provider credentials are never sent to or stored on the client.
 */
export async function extractBill(
  imageUri: string,
  mimeType?: string,
  fileName?: string,
  hintCurrency: BillCurrency = DEFAULT_CURRENCY,
): Promise<OCRExtractResponse> {

  if (!imageUri || !imageUri.trim()) {
    throw new OCRError('Image URI is empty. Please select an image first.', 'INVALID_URI');
  }

  const resolvedMime = 'image/jpeg';
  const baseName = fileName?.trim().replace(/\.[^.]+$/, '') || 'bill';
  const resolvedName = resolveFileName(`${baseName}.jpg`, resolvedMime);
  const uploadUri = await prepareImageForUpload(imageUri);

  // Safe log — URI prefix only, no content, no key
  console.log('[api] extractBill: URI prefix:', uploadUri.slice(0, 60));
  console.log('[api] extractBill: mimeType:', resolvedMime, '| fileName:', resolvedName);
  console.log('[api] extractBill: endpoint:', `${API_BASE_URL}/api/ocr/extract`);

  // ── Build multipart form ──────────────────────────────────────────────────
  // React Native's FormData polyfill accepts an object with uri/type/name.
  // Do NOT set Content-Type on the fetch call — the boundary is generated
  // automatically and setting it manually strips the boundary parameter,
  // causing FastAPI to reject the upload with 422 "No multipart boundary".
  const formData = new FormData();
  formData.append('file', {
    uri:  uploadUri,
    type: resolvedMime,
    name: resolvedName,
  } as any);
  formData.append('hint_currency', hintCurrency);

  // Confirm FormData fields — field name must be 'file' to match FastAPI endpoint
  console.log('[api] FormData fields: file (uri/type/name) + hint_currency:', hintCurrency);
  console.log('[api] FormData file.uri (first 80):', uploadUri.slice(0, 80));
  console.log('[api] FormData file.type:', resolvedMime);
  console.log('[api] FormData file.name:', resolvedName);

  // ── Abort controller for timeout ─────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    const t0 = Date.now();
    console.log('[api] Sending POST to:', `${API_BASE_URL}/api/ocr/extract`);
    console.log('[api] Content-Type header: intentionally omitted (RN fetch sets boundary automatically)');

    const response = await fetch(`${API_BASE_URL}/api/ocr/extract`, {
      method: 'POST',
      body:   formData,
      signal: controller.signal,
      // Content-Type intentionally omitted — React Native sets it with boundary
    });

    clearTimeout(timeoutId);

    const elapsed = Date.now() - t0;
    console.log('[api] HTTP', response.status, '| elapsed:', elapsed, 'ms');
    console.log('[api] Content-Type response header:', response.headers.get('content-type') ?? '(none)');

    // ── Error responses ───────────────────────────────────────────────────
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body?.detail ?? body?.message ?? JSON.stringify(body);
      } catch {
        detail = await response.text().catch(() => `HTTP ${response.status}`);
      }

      console.error('[api] Error response HTTP', response.status);
      console.error('[api] Error detail (first 300):', detail.slice(0, 300));

      switch (response.status) {
        case 400:
          throw new OCRError(
            detail || 'Invalid image format. Please use a clear JPEG, PNG, or WebP photo.',
            'INVALID_IMAGE',
            400,
          );
        case 422:
          throw new OCRError(
            detail || 'Could not read the bill. Try a clearer, well-lit photo.',
            'UNREADABLE',
            422,
          );
        case 503:
          throw new OCRError(
            detail || 'The selected OCR provider is temporarily unavailable. Please try again.',
            'OCR_PROVIDER_UNAVAILABLE',
            503,
          );
        case 404:
          throw new OCRError(
            detail || 'OCR endpoint not found. Check that the backend is running.',
            'NOT_FOUND',
            404,
          );
        default:
          throw new OCRError(
            detail || `Server returned HTTP ${response.status}. Please try again.`,
            'SERVER_ERROR',
            response.status,
          );
      }
    }

    // ── Success ───────────────────────────────────────────────────────────
    let data: unknown;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.error('[api] extractBill: JSON parse error:', parseErr);
      throw new OCRError(
        'The server returned an unreadable response. Please try again.',
        'BAD_RESPONSE',
      );
    }

    // Basic shape validation before casting
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as any).success !== 'boolean'
    ) {
      console.error('[api] extractBill: unexpected response shape:', JSON.stringify(data).slice(0, 200));
      throw new OCRError(
        'The server returned an unexpected response format. Please try again.',
        'BAD_RESPONSE',
      );
    }

    const ocr = data as OCRExtractResponse;

    if (!ocr.success) {
      throw new OCRError(
        ocr.message || 'OCR extraction failed. Please try again.',
        'OCR_FAILED',
      );
    }

    console.log('[api] OCR success — items:', ocr.items.length, '| confidence:', ocr.overall_confidence);
    console.log('[api] OCR success — restaurant_name:', ocr.restaurant_name ?? '(none)');
    console.log('[api] OCR success — detected_currency:', ocr.detected_currency);
    console.log('[api] OCR success — has_mismatch:', ocr.has_mismatch);
    if (ocr.gemini_warnings.length > 0) {
      console.warn('[api] OCR warnings:', ocr.gemini_warnings);
    }
    return ocr;

  } catch (err) {
    clearTimeout(timeoutId);

    // Re-throw our own typed errors unchanged
    if (err instanceof OCRError) throw err;

    // AbortController timeout
    if (
      (err instanceof DOMException && err.name === 'AbortError') ||
      // React Native sometimes throws a plain Error with 'AbortError' message
      (err instanceof Error && err.message.includes('AbortError'))
    ) {
      console.error('[api] extractBill: request aborted (timeout)');
      throw new OCRError(
        'Request timed out after 130 seconds. Please retry.',
        'TIMEOUT',
      );
    }

    // Network unreachable, DNS failure, etc.
    if (err instanceof TypeError) {
      console.error('[api] NETWORK ERROR — TypeError message:', err.message);
      console.error('[api] Network target was:', `${API_BASE_URL}/api/ocr/extract`);
      throw new OCRError(
        'Cannot reach the SplitMate AI server.\n\nCheck that:\n• The backend is running (uvicorn main:app)\n• Your phone is on the same Wi-Fi as your computer\n• The IP address in .env matches your machine\'s LAN IP',
        'NETWORK_ERROR',
      );
    }

    // Catch-all
    console.error('[api] UNKNOWN error type:', Object.prototype.toString.call(err));
    console.error('[api] UNKNOWN error value:', String(err));
    if (err instanceof Error) console.error('[api] UNKNOWN error stack:', err.stack);
    throw new OCRError(
      'An unexpected error occurred. Please try again.',
      'UNKNOWN',
    );
  }
}

async function prepareImageForUpload(imageUri: string): Promise<string> {
  const context = ImageManipulator.ImageManipulator.manipulate(imageUri, {
    maxWidth: MAX_UPLOAD_EDGE,
    maxHeight: MAX_UPLOAD_EDGE,
  });
  const renderedImage = await context.renderAsync();
  const result = await renderedImage.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: JPEG_QUALITY,
  });
  return result.uri;
}

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * Check if the backend is reachable.
 * Returns true when GET /health responds with 2xx.
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response   = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('[api] health check:', response.status);
    return response.ok;
  } catch (err) {
    console.warn('[api] health check failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Configured API base URL — safe to log and display. */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
