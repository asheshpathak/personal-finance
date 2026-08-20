import { api } from './api';

/**
 * The whole financial position, computed on the server.
 *
 * Every figure here — free cash flow, debt-to-income, runway, what a purchase
 * would do — comes from one implementation that the screens, the budget planner
 * and the assistant all read. That is the point: the moment the browser
 * computes its own version of "what's left over", the number on the dashboard
 * and the number in the chat start to disagree, and a person who notices that
 * once stops trusting both.
 */

export interface PositionDebt {
  name: string;
  lender: string;
  category: string;
  kind: string;
  balance: number;
  annualRate: number;
  instalment: number;
  frequency: string;
  monthlyCost: number;
  interestRemaining: number | null;
  payoffDay: string | null;
  periodsRemaining: number;
  nextDue: string | null;
  negativelyAmortizing: boolean;
  minimumDue: number;
  utilization: number | null;
  status: 'active' | 'closed';
  monthlyInterestCost: number;
  prepaymentsMade: { day: string; amount: number; effect: string }[];
  prepaymentsPlanned: { day: string; amount: number; effect: string }[];
  interestSavedByPrepayments: number;
  rateHistory: { effectiveFrom: string; annualRate: number }[];
}

export interface FinancialPosition {
  today: string;
  currency: 'USD' | 'INR';
  income: {
    monthly: number;
    conservativeMonthly: number;
    guaranteedMonthly: number;
    annual: number;
    empty: boolean;
    streams: { name: string; type: string; monthly: number; reliability: string }[];
    oneOffs: { name: string; amount: number }[];
  };
  debts: PositionDebt[];
  debtTotals: {
    count: number;
    balance: number;
    monthlyOutgo: number;
    interestRemaining: number;
    interestUnbounded: string[];
    monthlyInterestCost: number;
    lastPayoffDay: string | null;
    highestRate: PositionDebt | null;
    smallestBalance: PositionDebt | null;
  };
  subscriptions: { count: number; monthly: number; annual: number };
  assets: {
    total: number;
    liquid: number;
    available: number;
    netWorth: number;
    oldestAsOf: string | null;
    earmarked: { name: string; balance: number; purpose: string }[];
  };
  spending: {
    variableMonthly: number;
    discretionaryMonthly: number;
    essentialMonthly: number;
    setAsideMonthly: number;
    totalMonthly: number;
    monthsObserved: number;
    byCategory: {
      category: string;
      spendClass: 'essential' | 'discretionary' | 'setting-aside' | 'unclassified';
      median: number;
      mean: number;
      lastMonth: number;
      monthsWithSpend: number;
      total: number;
    }[];
    thisMonthSoFar: number;
    /** This month against a normal one, compared at the same day of the month. */
    pace: {
      soFar: number;
      typicalByNow: number;
      typicalFullMonth: number;
      ratio: number | null;
      status: 'ahead' | 'on-track' | 'behind' | 'too-early';
      dayOfMonth: number;
      monthsCompared: number;
    };
  };
  commitments: { debt: number; subscriptions: number; total: number };
  freeCashflowMonthly: number;
  freeCashflowConservative: number;
  debtToIncome: number | null;
  savingsRate: number | null;
  runwayMonths: number | null;
  monthsUntilBroke: number | null;
}

export const fetchPosition = () => api.get<FinancialPosition>('/api/position');

// ── Affordability ───────────────────────────────────────────────────────────

export interface AffordabilityAnswer {
  verdict: 'comfortable' | 'tight' | 'stretch' | 'no';
  headline: string;
  numbers: {
    cost: number;
    availableNow: number;
    earmarkedUsed: { name: string; balance: number; purpose: string }[];
    earmarkedAvailableForThisPurpose: { name: string; balance: number; purpose: string }[];
    emergencyBuffer: number;
    spendableNow: number;
    availableAfter: number;
    freeCashflowMonthly: number;
    freeCashflowAfter: number;
    runwayAfterMonths: number | null;
    monthlyInstalment: number;
    financingCost: number;
    debtToIncomeAfter: number | null;
    monthsToSave: number | null;
    affordableFrom: string | null;
  };
  cautions: string[];
  options: string[];
  missing: string[];
}

export interface AffordabilityRequest {
  label: string;
  amount: number;
  financing?: 'cash' | 'emi';
  emiMonths?: number;
  emiRate?: number;
  recurringMonthly?: number;
  bufferMonths?: number;
  useEarmarked?: boolean;
}

export const checkAffordability = (body: AffordabilityRequest) =>
  api.post<AffordabilityAnswer>('/api/position/affordability', body);

// ── Budget planning ─────────────────────────────────────────────────────────

export interface PlannedLine {
  name: string;
  allocatedAmount: number;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DraftBudget {
  startDate: string;
  endDate: string;
  days: number;
  income: number;
  incomeConservative: number;
  categories: PlannedLine[];
  investments: PlannedLine[];
  savings: PlannedLine[];
  subscriptions: { name: string; amount: number; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' }[];
  debts: { name: string; amount: number; instalments: number }[];
  totals: { committed: number; discretionary: number; allocated: number; unallocated: number };
  warnings: string[];
}

export const fetchBudgetDraft = (body: {
  startDate?: string;
  endDate?: string;
  savingsTarget?: number;
  conservative?: boolean;
  exclude?: string[];
}) => api.post<DraftBudget>('/api/position/budget-draft', body);

/** The tone a verdict should render in. */
export const VERDICT_TONE: Record<AffordabilityAnswer['verdict'], 'positive' | 'warning' | 'negative'> = {
  comfortable: 'positive',
  tight: 'warning',
  stretch: 'warning',
  no: 'negative',
};

export const VERDICT_LABEL: Record<AffordabilityAnswer['verdict'], string> = {
  comfortable: 'Yes',
  tight: 'Tight',
  stretch: 'A stretch',
  no: 'Not yet',
};
