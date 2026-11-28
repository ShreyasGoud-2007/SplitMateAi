import type {
  BillImageMetadata,
  BillItem,
  BillMetadata,
  BillSource,
  CanonicalBill,
} from '@/types/bill';
import { BILL_CURRENCIES, type BillCurrency } from '@/types/splitSession';
import { applyRatePaise, DEFAULT_TAX_RATE } from '@/utils/currency';
import { createId } from '@/utils/ids';

export type BillNormalizationInput = Omit<Partial<CanonicalBill>, 'items' | 'currency'> & {
  currency?: string;
  items: (Partial<BillItem> & Pick<BillItem, 'name' | 'qty' | 'unitPricePaise'>)[];
};

function normalizeOptionalAmount(
  value: number | null | undefined,
  field: string,
  warnings: string[],
): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    warnings.push(`${field} was invalid and has been set to 0 paise.`);
    return 0;
  }
  const absolute = Math.abs(numeric);
  const normalized = Math.min(Number.MAX_SAFE_INTEGER, Math.round(absolute));
  if (numeric < 0) warnings.push(`${field} was negative and has been normalized to its absolute value.`);
  if (!Number.isSafeInteger(numeric) || normalized !== numeric) {
    warnings.push(`${field} was not a safe integer amount of paise and has been rounded.`);
  }
  return normalized;
}

function normalizeCurrency(value: string | undefined): BillCurrency {
  if (BILL_CURRENCIES.some(({ code }) => code === value)) return value as BillCurrency;
  return 'INR';
}

export function normalizeBill(input: BillNormalizationInput): CanonicalBill {
  if (!Array.isArray(input.items)) throw new Error('Bill items must be an array.');

  const validationWarnings: string[] = Array.isArray(input.metadata?.validationWarnings)
    ? input.metadata.validationWarnings.filter(
        (warning): warning is string => typeof warning === 'string',
      )
    : [];
  const itemIds = new Set<string>();
  const items = input.items.map((item, index): BillItem => {
    if (typeof item.name !== 'string') {
      throw new Error(`Bill item ${index + 1} needs a name.`);
    }
    const name = item.name.trim();
    if (!name) throw new Error(`Bill item ${index + 1} needs a name.`);
    if (!Number.isFinite(item.qty) || item.qty <= 0 || item.qty > 100_000) {
      throw new Error(`Quantity for "${name}" must be greater than zero.`);
    }
    const unitPricePaise = normalizeOptionalAmount(
      item.unitPricePaise,
      `Unit price for "${name}"`,
      validationWarnings,
    ) ?? 0;
    const calculatedLineTotal = Math.round(unitPricePaise * item.qty);
    if (!Number.isSafeInteger(calculatedLineTotal)) {
      throw new Error(`Line total for "${name}" is outside the supported range.`);
    }
    const providedLineTotal = normalizeOptionalAmount(
      item.lineTotalPaise,
      `Line total for "${name}"`,
      validationWarnings,
    );
    const lineTotalPaise = providedLineTotal ?? calculatedLineTotal;
    if (providedLineTotal !== null && providedLineTotal !== calculatedLineTotal) {
      validationWarnings.push(`Printed line total for "${name}" was preserved for review.`);
    }

    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createId();
    if (itemIds.has(id)) throw new Error(`Bill item IDs must be unique (duplicate ID: ${id}).`);
    itemIds.add(id);

    return {
      id,
      name,
      qty: item.qty,
      unitPricePaise,
      lineTotalPaise,
      unitPrice: unitPricePaise / 100,
      confidence:
        typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.min(1, Math.max(0, item.confidence))
          : undefined,
    };
  });

  const subtotalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  if (!Number.isSafeInteger(subtotalPaise)) {
    throw new Error('Bill subtotal is outside the supported range.');
  }
  const detectedSubtotalPaise = normalizeOptionalAmount(
    input.detectedSubtotalPaise,
    'Detected subtotal',
    validationWarnings,
  );
  const detectedGstPaise = normalizeOptionalAmount(
    input.detectedGstPaise,
    'Detected GST',
    validationWarnings,
  );
  const detectedDiscountPaise = normalizeOptionalAmount(
    input.detectedDiscountPaise,
    'Detected discount',
    validationWarnings,
  );
  const detectedServiceChargePaise = normalizeOptionalAmount(
    input.detectedServiceChargePaise,
    'Detected service charge',
    validationWarnings,
  );
  const detectedOtherChargesPaise = normalizeOptionalAmount(
    input.detectedOtherChargesPaise,
    'Detected other charges',
    validationWarnings,
  );
  const detectedRoundOffPaise = normalizeOptionalAmount(
    input.detectedRoundOffPaise,
    'Detected round-off',
    validationWarnings,
  );
  const detectedGrandTotalPaise = normalizeOptionalAmount(
    input.detectedGrandTotalPaise,
    'Detected grand total',
    validationWarnings,
  );

  if (detectedSubtotalPaise !== null && Math.abs(detectedSubtotalPaise - subtotalPaise) > 1) {
    validationWarnings.push('Detected subtotal differs from the normalized item subtotal.');
  }

  const explicitTaxPaise = normalizeOptionalAmount(input.taxPaise, 'Tax', validationWarnings);
  const taxIsEstimated =
    input.metadata?.taxIsEstimated ??
    (detectedGstPaise === null && explicitTaxPaise === null);
  const estimatedTaxPaise = applyRatePaise(subtotalPaise, DEFAULT_TAX_RATE);
  const taxPaise = detectedGstPaise
    ?? (taxIsEstimated ? estimatedTaxPaise : explicitTaxPaise ?? estimatedTaxPaise);
  const serviceChargePaise = detectedServiceChargePaise ?? 0;
  const otherChargesPaise = detectedOtherChargesPaise ?? 0;
  const roundOffPaise = detectedRoundOffPaise ?? 0;
  const discountPaise = detectedDiscountPaise ?? 0;
  const calculatedTotalPaise = Math.max(
    0,
    subtotalPaise + taxPaise + serviceChargePaise + otherChargesPaise + roundOffPaise - discountPaise,
  );
  if (!Number.isSafeInteger(calculatedTotalPaise)) {
    throw new Error('Calculated bill total is outside the supported range.');
  }
  const totalPaise = calculatedTotalPaise;
  if (
    detectedGrandTotalPaise !== null &&
    Math.abs(detectedGrandTotalPaise - calculatedTotalPaise) > 1
  ) {
    validationWarnings.push('Detected grand total differs from the normalized bill total.');
  }

  const source: BillSource =
    input.source ?? (input.isDemoData ? 'demo' : 'manual');
  if (!['ocr', 'manual', 'demo'].includes(source)) {
    throw new Error('Bill source must be ocr, manual, or demo.');
  }

  const imageMetadata: BillImageMetadata | undefined = input.imageMetadata
    ? { ...input.imageMetadata }
    : input.imageUri
      ? { uri: input.imageUri }
      : undefined;
  const imageUri = input.imageUri || imageMetadata?.uri;
  const metadata: BillMetadata = {
    ...input.metadata,
    taxIsEstimated,
    validationWarnings: [...new Set(validationWarnings)],
  };
  const createdAt =
    input.createdAt && !Number.isNaN(Date.parse(input.createdAt))
      ? new Date(input.createdAt).toISOString()
      : new Date().toISOString();

  return {
    ...input,
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createId(),
    source,
    currency: normalizeCurrency(input.currency ?? input.detectedCurrency),
    imageUri: imageUri || undefined,
    imageMetadata,
    subtotalPaise,
    taxPaise,
    totalPaise,
    items,
    createdAt,
    metadata,
    detectedSubtotalPaise,
    detectedSubtotal:
      detectedSubtotalPaise === null ? null : detectedSubtotalPaise / 100,
    detectedGstPaise,
    detectedDiscountPaise,
    detectedServiceChargePaise,
    detectedOtherChargesPaise,
    detectedRoundOffPaise,
    detectedGrandTotalPaise,
    detectedCurrency: input.detectedCurrency ?? normalizeCurrency(input.currency),
    isDemoData: source === 'demo',
  };
}
