import type { BillCurrency } from '@/types/splitSession';

const formatters = new Map<BillCurrency, Intl.NumberFormat>();

export function formatSplitCurrency(amountMinorUnits: number, currency: BillCurrency): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(amountMinorUnits / 100);
}
