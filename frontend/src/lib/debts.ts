import { api } from './api';
import type { Frequency } from './subscriptionTotals';
import type { DayOfWeek, PendingSchedule } from './subscriptionDueDate';

/**
 * The client half of debt.
 *
 * Everything derived — the balance, the payoff date, the interest still to
 * come — arrives from the server rather than being recomputed here. That is
 * deliberate: the amortization replay is the same code the assistant reasons
 * with and the same code the budget planner subtracts from, and a second
 * implementation in the browser would be a second set of numbers that agrees
 * with the first until the month it does not.
 */

export const DEBT_CATEGORIES = [
  'Home Loan',
  'Car Loan',
  'Personal Loan',
  'Education Loan',
  'Credit Card',
  'Gold Loan',
  'Business Loan',
  'Consumer Durable / BNPL',
  'Family & Friends',
  'Medical Debt',
  'Overdraft',
  'Other Debt',
] as const;

export type DebtCategory = (typeof DEBT_CATEGORIES)[number];

export type DebtKind = 'amortizing' | 'revolving' | 'interest-free';

/**
 * How the balance behaves — the maths, not the label.
 *
 * Presented in the form as a question about the debt rather than as jargon,
 * because "amortizing" is a word almost nobody outside finance uses and the
 * distinction it draws is one everybody understands.
 */
export const DEBT_KINDS: { value: DebtKind; label: string; blurb: string }[] = [
  {
    value: 'amortizing',
    label: 'Fixed instalments',
    blurb: 'A loan with a set EMI and an end date — home, car, personal, education.',
  },
  {
    value: 'revolving',
    label: 'Revolving balance',
    blurb: 'A credit card or overdraft. No fixed term; what you pay is what you choose.',
  },
  {
    value: 'interest-free',
    label: 'No interest',
    blurb: 'A family loan, a 0% EMI plan, a hospital instalment plan.',
  },
];

export type PrepaymentEffect = 'reduce-tenure' | 'reduce-emi';

export interface Prepayment {
  _id: string;
  day: string;
  amount: number;
  effect: PrepaymentEffect;
  note?: string;
  recorded: boolean;
}

export interface RateChange {
  _id: string;
  effectiveFrom: string;
  annualRate: number;
  note?: string;
}

export interface DebtRecord {
  _id: string;
  name: string;
  lender: string;
  category: DebtCategory;
  kind: DebtKind;
  principal: number;
  openingBalance: number;
  balanceAsOf: string;
  annualRate: number;
  emiAmount: number;
  frequency: Frequency;
  dueDayOfWeek: DayOfWeek | null;
  dueDayOfMonth: number | null;
  dueMonth: number | null;
  termMonths: number | null;
  minimumFraction: number | null;
  minimumFloor: number | null;
  creditLimit: number | null;
  prepayments: Prepayment[];
  rateChanges: RateChange[];
  autoRecord: boolean;
  paymentMode: string;
  startDay: string | null;
  lastChargedDay: string | null;
  pendingSchedule: PendingSchedule | null;
  pendingEffectiveFrom: string | null;
  status: 'active' | 'closed';
  closedOn: string | null;
  notes: string;

  // ── Derived on the server ────────────────────────────────────────────────
  /** Replayed from the anchor through every instalment and part payment. */
  balance: number;
  monthlyCost: number;
  monthlyInterestCost: number;
  /** Null when the payment does not cover the interest, so there is no total. */
  interestRemaining: number | null;
  totalRemaining: number | null;
  payoffDay: string | null;
  periodsRemaining: number;
  negativelyAmortizing: boolean;
  minimumDue: number;
  utilization: number | null;
  paidOffFraction: number | null;
  nextDueDay: string | null;
}

export interface Instalment {
  day: string;
  number: number;
  openingBalance: number;
  interest: number;
  principal: number;
  payment: number;
  prepaid: number;
  closingBalance: number;
  annualRate: number;
}

export interface DebtSchedule {
  balance: number;
  schedule: Instalment[];
  scheduleTruncated: boolean;
  payoffDay: string | null;
  periodsRemaining: number;
  interestRemaining: number;
  totalRemaining: number;
  negativelyAmortizing: boolean;
}

export interface PrepaymentSimulation {
  balance: number;
  interestWithout: number;
  interestWith: number;
  interestSaved: number;
  payoffWithout: string | null;
  payoffWith: string | null;
  periodsSaved: number;
  instalmentAfter: number;
  instalmentBefore: number;
  /** The same money as a permanently larger instalment, for comparison. */
  ifInstalmentRose: {
    extraPerPeriod: number;
    payoffDay: string | null;
    interestRemaining: number;
    interestSaved: number;
    periodsSaved: number;
  };
}

// ── API ─────────────────────────────────────────────────────────────────────

export const listDebts = () => api.get<DebtRecord[]>('/api/debts');

export const createDebt = (body: unknown) => api.post<DebtRecord>('/api/debts', body);

export const updateDebt = (id: string, body: unknown) => api.put<DebtRecord>(`/api/debts/${id}`, body);

export const deleteDebt = (id: string) => api.delete<{ message: string }>(`/api/debts/${id}`);

export const closeDebt = (id: string, on?: string) =>
  api.post<DebtRecord>(`/api/debts/${id}/close`, on ? { on } : {});

export const reopenDebt = (id: string) => api.post<DebtRecord>(`/api/debts/${id}/reopen`, {});

export const addPrepayment = (
  id: string,
  body: { day: string; amount: number; effect: PrepaymentEffect; note?: string }
) => api.post<DebtRecord>(`/api/debts/${id}/prepayments`, body);

export const removePrepayment = (id: string, prepaymentId: string) =>
  api.delete<DebtRecord>(`/api/debts/${id}/prepayments/${prepaymentId}`);

export const simulatePrepayment = (
  id: string,
  body: { amount: number; day?: string; effect?: PrepaymentEffect }
) => api.post<PrepaymentSimulation>(`/api/debts/${id}/simulate`, body);

export const fetchSchedule = (id: string) => api.get<DebtSchedule>(`/api/debts/${id}/schedule`);

export const discardPendingSchedule = (id: string) =>
  api.delete<DebtRecord>(`/api/debts/${id}/pending-schedule`);

// ── Presentation ────────────────────────────────────────────────────────────

/**
 * How much of the debt is behind them, as a fraction.
 *
 * Falls back to null rather than 0 when the original figure is unknown — a
 * progress bar sitting at zero for a loan that is nearly paid off is worse than
 * no progress bar.
 */
export const progressOf = (debt: DebtRecord): number | null => debt.paidOffFraction;

/** Debts first by whether they are growing, then by what they cost in interest. */
export function rankDebts(debts: DebtRecord[]): DebtRecord[] {
  return [...debts].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    // A debt that is growing is the most important row on the page, whatever
    // its size — it is the only one where doing nothing makes things worse.
    if (a.negativelyAmortizing !== b.negativelyAmortizing) return a.negativelyAmortizing ? -1 : 1;
    return b.monthlyInterestCost - a.monthlyInterestCost || b.balance - a.balance;
  });
}

export interface DebtTotals {
  count: number;
  balance: number;
  monthlyOutgo: number;
  monthlyInterest: number;
  /** Null when any active debt never clears. */
  lastPayoffDay: string | null;
  growing: DebtRecord[];
}

export function debtTotals(debts: DebtRecord[]): DebtTotals {
  const active = debts.filter(d => d.status === 'active');
  const payoffs = active.map(d => d.payoffDay).filter((d): d is string => Boolean(d));

  return {
    count: active.length,
    balance: active.reduce((sum, d) => sum + d.balance, 0),
    monthlyOutgo: active.reduce((sum, d) => sum + d.monthlyCost, 0),
    monthlyInterest: active.reduce((sum, d) => sum + d.monthlyInterestCost, 0),
    // Only when every one of them ends. "Debt free by 2031" is a lie if one is
    // a card whose minimum never touches the principal.
    lastPayoffDay:
      active.length > 0 && payoffs.length === active.length ? payoffs.sort().slice(-1)[0] ?? null : null,
    growing: active.filter(d => d.negativelyAmortizing),
  };
}

/** "8 years 3 months", from a count of monthly instalments. */
export function describeTerm(periods: number, frequency: Frequency): string {
  if (periods <= 0) return '—';
  if (frequency !== 'monthly') return `${periods} payments`;
  const years = Math.floor(periods / 12);
  const months = periods % 12;
  if (years === 0) return `${months} month${months === 1 ? '' : 's'}`;
  if (months === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years}y ${months}m`;
}
