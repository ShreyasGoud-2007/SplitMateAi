export type BillCurrency = 'INR' | 'USD' | 'EUR' | 'GBP';

export interface SplitParticipant {
  id: string;
  name: string;
  isCurrentUser: boolean;
}

export interface SplitSession {
  id: string;
  groupName: string;
  restaurantName: string | null;
  currency: BillCurrency;
  participants: SplitParticipant[];
  createdAt: string;
}

export const BILL_CURRENCIES: {
  code: BillCurrency;
  symbol: string;
  label: string;
}[] = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
];
