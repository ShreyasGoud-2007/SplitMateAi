import type { CanonicalBill, BillImageMetadata, BillItem } from '@/types/bill';
import type { OCRExtractResponse } from '@/utils/api';
import { normalizeBill } from '@/utils/billNormalization';
import { createId } from '@/utils/ids';

/**
 * OCR boundary: map the current API response into the same validated bill
 * model used by demo and manual bills. Replace only this adapter if OCR changes.
 */
export function adaptOCRResponseToBill(
  response: OCRExtractResponse,
  imageMetadata?: BillImageMetadata,
): CanonicalBill {
  if (!response.success) {
    throw new Error(response.message || 'OCR did not return a bill.');
  }

  return normalizeBill({
    id: createId(),
    source: 'ocr',
    currency: response.detected_currency,
    imageUri: imageMetadata?.uri,
    imageMetadata,
    items: response.items.map((item) => ({
      id: item.id || createId(),
      name: item.name,
      qty: item.qty,
      unitPricePaise: item.unit_price_paise,
      unitPrice: item.unit_price_paise / 100,
      lineTotalPaise: item.line_total_paise,
      confidence: item.confidence,
    })),
    detectedSubtotalPaise: response.detected_subtotal_paise,
    detectedSubtotal:
      response.detected_subtotal_paise === null
        ? null
        : response.detected_subtotal_paise / 100,
    detectedCurrency: response.detected_currency,
    currencyMismatch: response.currency_mismatch,
    detectedGstPaise: response.detected_gst_paise,
    detectedDiscountPaise: response.detected_discount_paise,
    detectedServiceChargePaise: response.detected_service_charge_paise,
    detectedOtherChargesPaise: response.detected_other_charges_paise,
    detectedRoundOffPaise: response.detected_round_off_paise,
    detectedGrandTotalPaise: response.detected_grand_total_paise,
    computedSubtotalPaise: response.computed_subtotal_paise,
    computedGrandTotalPaise: response.computed_grand_total_paise,
    validationWarnings: response.validation_warnings,
    hasMismatch: response.has_mismatch,
    overallConfidence: response.overall_confidence,
    geminiWarnings: response.gemini_warnings,
    metadata: {
      taxIsEstimated: response.detected_gst_paise === null,
    },
    isDemoData: false,
  });
}

export function createManualBill(input: {
  items: BillItem[];
  currency?: string;
  restaurantName?: string | null;
  taxPaise?: number;
  imageMetadata?: BillImageMetadata;
}): CanonicalBill {
  return normalizeBill({
    id: createId(),
    source: 'manual',
    currency: input.currency ?? 'INR',
    restaurantName: input.restaurantName,
    imageUri: input.imageMetadata?.uri,
    imageMetadata: input.imageMetadata,
    items: input.items,
    taxPaise: input.taxPaise,
    metadata: { taxIsEstimated: input.taxPaise === undefined },
    isDemoData: false,
  });
}
