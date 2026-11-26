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

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeOptionalAmount(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!isNonNegativeSafeInteger(value)) {
    throw new Error(`${field} must be a non-negative integer number of paise.`);
  }
  return value;
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
    if (!Number.isSafeInteger(item.unitPricePaise) || item.unitPricePaise < 0) {
      throw new Error(`Unit price for "${name}" must be a non-negative integer number of paise.`);
    }

    const calculatedLineTotal = Math.round(item.unitPricePaise * item.qty);
    if (!Number.isSafeInteger(calculatedLineTotal)) {
      throw new Error(`Line total for "${name}" is outside the supported range.`);
    }
    if (
      item.lineTotalPaise !== undefined &&
      (!Number.isSafeInteger(item.lineTotalPaise) || item.lineTotalPaise < 0)
    ) {
      throw new Error(`Line total for "${name}" must be a non-negative integer number of paise.`);
    }
    if (item.lineTotalPaise !== undefined && item.lineTotalPaise !== calculatedLineTotal) {
      validationWarnings.push(
        `Line total for "${name}" was normalized from unit price × quantity.`,
      );
    }

    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createId();
    if (itemIds.has(id)) throw new Error(`Bill item IDs must be unique (duplicate ID: ${id}).`);
    itemIds.add(id);

    return {
      id,
      name,
      qty: item.qty,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: calculatedLineTotal,
      unitPrice: item.unitPricePaise / 100,
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
  const declaredSubtotal = normalizeOptionalAmount(input.subtotalPaise, 'Bill subtotal');
  if (declaredSubtotal !== null && Math.abs(declaredSubtotal - subtotalPaise) > 1) {
    validationWarnings.push('Provided subtotal differs from the normalized item subtotal.');
  }

  const detectedSubtotalPaise = normalizeOptionalAmount(
    input.detectedSubtotalPaise,
    'Detected subtotal',
  );
  const detectedGstPaise = normalizeOptionalAmount(input.detectedGstPaise, 'Detected GST');
  const detectedDiscountPaise = normalizeOptionalAmount(input.detectedDiscountPaise, 'Detected discount');
  const detectedServiceChargePaise = normalizeOptionalAmount(
    input.detectedServiceChargePaise,
    'Detected service charge',
  );
  const detectedGrandTotalPaise = normalizeOptionalAmount(
    input.detectedGrandTotalPaise,
    'Detected grand total',
  );

  if (detectedSubtotalPaise !== null && Math.abs(detectedSubtotalPaise - subtotalPaise) > 1) {
    validationWarnings.push('Detected subtotal differs from the normalized item subtotal.');
  }

  const explicitTaxPaise = normalizeOptionalAmount(input.taxPaise, 'Tax');
  const taxIsEstimated =
    input.metadata?.taxIsEstimated ??
    (detectedGstPaise === null && explicitTaxPaise === null);
  const estimatedTaxPaise = applyRatePaise(subtotalPaise, DEFAULT_TAX_RATE);
  const taxPaise = detectedGstPaise
    ?? (taxIsEstimated ? estimatedTaxPaise : explicitTaxPaise ?? estimatedTaxPaise);
  const serviceChargePaise = detectedServiceChargePaise ?? 0;
  const discountPaise = detectedDiscountPaise ?? 0;
  const calculatedTotalPaise = Math.max(
    0,
    subtotalPaise + taxPaise + serviceChargePaise - discountPaise,
  );
  if (!Number.isSafeInteger(calculatedTotalPaise)) {
    throw new Error('Calculated bill total is outside the supported range.');
  }
  const totalPaise = detectedGrandTotalPaise ?? calculatedTotalPaise;

  if (!Number.isSafeInteger(totalPaise)) throw new Error('Bill total is outside the supported range.');
  const declaredTotal = normalizeOptionalAmount(input.totalPaise, 'Bill total');
  if (
    declaredTotal !== null &&
    detectedGrandTotalPaise === null &&
    Math.abs(declaredTotal - calculatedTotalPaise) > 1
  ) {
    validationWarnings.push('Provided bill total differs from the normalized total.');
  }
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
    validationWarnings,
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
    detectedGrandTotalPaise,
    detectedCurrency: input.detectedCurrency ?? normalizeCurrency(input.currency),
    isDemoData: source === 'demo',
  };
}
