/**
 * BillStore — lightweight React context that holds the active ExtractedBill
 * between the Review screen (which triggers extraction) and the Results screen
 * (which displays and edits the bill).
 *
 * This avoids encoding large item arrays in URL params and gives both screens
 * a shared mutable reference.
 */

import { buildDemoBill, type BillValidationWarning, type ExtractedBill } from '@/types/bill';
import type { OCRExtractResponse } from '@/utils/api';
import React, { createContext, useCallback, useContext, useRef } from 'react';

interface BillStoreContextValue {
  /** Set the active bill (called from review.tsx after extraction). */
  setBill: (bill: ExtractedBill) => void;
  /** Get the active bill (called from results.tsx on mount). */
  getBill: () => ExtractedBill | null;
}

const BillStoreContext = createContext<BillStoreContextValue | null>(null);

export function BillStoreProvider({ children }: { children: React.ReactNode }) {
  // useRef so mutations don't cause re-renders of the provider tree
  const billRef = useRef<ExtractedBill | null>(null);

  const setBill = useCallback((bill: ExtractedBill) => {
    billRef.current = bill;
  }, []);

  const getBill = useCallback(() => billRef.current, []);

  return React.createElement(
    BillStoreContext.Provider,
    { value: { setBill, getBill } },
    children,
  );
}

export function useBillStore(): BillStoreContextValue {
  const ctx = useContext(BillStoreContext);
  if (!ctx) {
    throw new Error('useBillStore must be used inside <BillStoreProvider>');
  }
  return ctx;
}

/**
 * Convenience: build and store a demo bill for a given image URI.
 * Returns the bill so the caller can inspect it immediately.
 */
export function storeDemoBill(
  setBill: BillStoreContextValue['setBill'],
  imageUri: string,
): ExtractedBill {
  const bill = buildDemoBill(imageUri);
  setBill(bill);
  return bill;
}

/**
 * Map a real OCR API response to an ExtractedBill and store it.
 *
 * Converts the backend's snake_case fields to the frontend's camelCase
 * and maps each OCRItem to a BillItem with paise values.
 */
export function storeOCRResult(
  setBill: BillStoreContextValue['setBill'],
  imageUri: string,
  ocr: OCRExtractResponse,
): ExtractedBill {
  const bill: ExtractedBill = {
    imageUri,
    items: ocr.items.map((item) => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      unitPricePaise: item.unit_price_paise,
      unitPrice: item.unit_price_paise / 100,
      confidence: item.confidence,
    })),
    detectedSubtotalPaise: ocr.detected_subtotal_paise,
    detectedSubtotal:
      ocr.detected_subtotal_paise !== null
        ? ocr.detected_subtotal_paise / 100
        : null,
    detectedCurrency: ocr.detected_currency || 'INR',
    isDemoData: false,

    // Real OCR fields
    restaurantName: ocr.restaurant_name,
    detectedGstPaise: ocr.detected_gst_paise,
    detectedDiscountPaise: ocr.detected_discount_paise,
    detectedServiceChargePaise: ocr.detected_service_charge_paise,
    detectedGrandTotalPaise: ocr.detected_grand_total_paise,
    computedSubtotalPaise: ocr.computed_subtotal_paise,
    computedGrandTotalPaise: ocr.computed_grand_total_paise,
    validationWarnings: ocr.validation_warnings as BillValidationWarning[] | undefined,
    hasMismatch: ocr.has_mismatch,
    overallConfidence: ocr.overall_confidence,
    geminiWarnings: ocr.gemini_warnings,
  };

  setBill(bill);
  return bill;
}
