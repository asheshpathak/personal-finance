import { api } from './api';

/**
 * Income, as an account-level fact.
 *
 * It used to be a number typed into each budget, which meant it had to be
 * retyped every period and was invisible to every other screen. Now it lives
 * here and a budget's figure is seeded from it — so "what is left over", "can I
 * afford this" and "how long could I last" have a denominator for the first
 * time.
 */

export const INCOME_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half-yearly', label: 'Half-yearly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'one-off', label: 'One-off' },
] as const;

export type IncomeFrequency = (typeof INCOME_FREQUENCIES)[number]['value'];

export const INCOME_TYPES = [
  'Salary',
  'Freelance',
  'Business',
  'Rental',
  'Dividend & Interest',
  'Pension',
  'Bonus',
  'Reimbursement',
  'Family Support',
  'Other Income',
] as const;

export type IncomeType = (typeof INCOME_TYPES)[number];

export type Reliability = 'guaranteed' | 'likely' | 'variable';

/**
 * How dependable a stream is.
 *
 * The wording matters more than it looks. A salary and a freelance retainer at
 * the same monthly figure are not the same money, and every "can I afford this"
 * answer that treats them identically is wrong in the direction that hurts. The
 * labels are written so someone picks the honest one without having to think
 * about what the app will do with it.
 */
export const RELIABILITY: { value: Reliability; label: string; blurb: string }[] = [
  { value: 'guaranteed', label: 'Dependable', blurb: 'Arrives every period, same amount.' },
  { value: 'likely', label: 'Usually arrives', blurb: 'Reliable, but not contractual.' },
  { value: 'variable', label: 'Varies a lot', blurb: 'Good months and lean ones. Planning uses the lean figure.' },
];

export interface IncomeSourceRecord {
  _id: string;
  name: string;
  type: IncomeType;
  amount: number;
  frequency: IncomeFrequency;
  payDayOfMonth: number | null;
  reliability: Reliability;
  typicalLow: number | null;
  startDay: string | null;
  endDay: string | null;
  active: boolean;
  notes: string;
}

export interface IncomeSummary {
  monthly: number;
  conservativeMonthly: number;
  guaranteedMonthly: number;
  annual: number;
  streams: (IncomeSourceRecord & { monthly: number })[];
  oneOffs: IncomeSourceRecord[];
  empty: boolean;
}

export const listIncome = () =>
  api.get<{ sources: IncomeSourceRecord[]; summary: IncomeSummary }>('/api/income');

export const createIncome = (body: unknown) => api.post<IncomeSourceRecord>('/api/income', body);

export const updateIncome = (id: string, body: unknown) =>
  api.put<IncomeSourceRecord>(`/api/income/${id}`, body);

export const deleteIncome = (id: string) => api.delete<{ message: string }>(`/api/income/${id}`);

// ── Savings balances ────────────────────────────────────────────────────────

export const ASSET_KINDS = [
  'Cash & Bank',
  'Emergency Fund',
  'Fixed Deposit',
  'Stocks & Mutual Funds',
  'Retirement',
  'Gold',
  'Crypto',
  'Real Estate',
  'Other Asset',
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetRecord {
  _id: string;
  name: string;
  kind: AssetKind;
  balance: number;
  asOf: string;
  liquid: boolean;
  ringFenced: boolean;
  earmarkedFor: string;
  notes: string;
}

export interface AssetSummary {
  total: number;
  liquid: number;
  available: number;
  oldestAsOf: string | null;
}

export const listAssets = () =>
  api.get<{ assets: AssetRecord[]; summary: AssetSummary }>('/api/assets');

export const createAsset = (body: unknown) => api.post<AssetRecord>('/api/assets', body);

export const updateAsset = (id: string, body: unknown) => api.put<AssetRecord>(`/api/assets/${id}`, body);

export const deleteAsset = (id: string) => api.delete<{ message: string }>(`/api/assets/${id}`);

/** Instalments a year, for the monthly-equivalent figure shown beside a stream. */
const PER_YEAR: Record<IncomeFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  'half-yearly': 2,
  yearly: 1,
  // A signing bonus is real money and not a *rate*. Folding it into "what I
  // earn a month" is how someone plans a permanent lifestyle around a single
  // payment, so it contributes nothing to the monthly figure and is counted
  // where it lands instead.
  'one-off': 0,
};

export const monthlyEquivalent = (amount: number, frequency: IncomeFrequency): number =>
  (amount * PER_YEAR[frequency]) / 12;
