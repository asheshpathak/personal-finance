import { toAnnualCost, type Frequency } from './subscriptionTotals';

/** A single planned line inside a section. */
export interface Allocation {
  name: string;
  allocatedAmount: number;
}

/** A subscription pulled into a budget, snapshotted at planning time. */
export interface BudgetSubscription {
  subscriptionId?: string | null;
  name: string;
  amount: number;
  frequency: Frequency;
}

export interface Budget {
  _id: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  income?: number;
  /** The spending section. Named `categories` since budgets predate sections. */
  categories: Allocation[];
  investments?: Allocation[];
  savings?: Allocation[];
  subscriptions?: BudgetSubscription[];
}

export interface ExpenseLike {
  amount: number;
  category: string;
  description?: string;
  date: string;
}

export type SectionKey = 'expenses' | 'investments' | 'savings' | 'subscriptions';

export const SECTION_ORDER: SectionKey[] = ['expenses', 'investments', 'savings', 'subscriptions'];

/** One hue per section, so a colour always means the same thing everywhere. */
export const SECTION_META: Record<SectionKey, { label: string; blurb: string; color: string }> = {
  expenses:      { label: 'Spending',      blurb: 'Day-to-day expenses',           color: 'hsl(255, 100%, 71%)' },
  investments:   { label: 'Investments',   blurb: 'Money put to work',             color: 'hsl(190, 90%, 55%)' },
  savings:       { label: 'Savings',       blurb: 'Money set aside',               color: 'hsl(152, 65%, 50%)' },
  subscriptions: { label: 'Subscriptions', blurb: 'Recurring charges you signed up for', color: 'hsl(38, 95%, 58%)' },
};

/** The expense category subscription payments are recorded under. */
export const SUBSCRIPTION_CATEGORY = 'Subscriptions';

/** Inclusive length of the budget period in days; never less than one. */
export function periodDays(startDate: string, endDate: string): number {
  const start = new Date(startDate).setHours(0, 0, 0, 0);
  const end = new Date(endDate).setHours(0, 0, 0, 0);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/**
 * What a subscription costs across a window of `days`. Prorated from the annual
 * cost so a 15-day budget carries half a monthly charge rather than a whole one.
 */
export function subscriptionCostForPeriod(
  sub: { amount: number; frequency: Frequency },
  days: number
): number {
  return (toAnnualCost(sub) / 365) * days;
}

export function subscriptionsTotalForPeriod(subs: BudgetSubscription[], days: number): number {
  return subs.reduce((sum, s) => sum + subscriptionCostForPeriod(s, days), 0);
}

export interface UtilizationItem {
  category: string;
  allocated: number;
  spent: number;
  remaining: number;
  /** Capped at 100 — drives bar and arc geometry. */
  percentage: number;
  /** Uncapped — what gets displayed, so 140% doesn't read as 100%. */
  rawPercentage: number;
}

export interface UtilizationSection extends Omit<UtilizationItem, 'category'> {
  key: SectionKey;
  label: string;
  color: string;
  items: UtilizationItem[];
}

export interface BudgetTotals {
  income: number;
  allocated: number;
  spent: number;
  remaining: number;
  /** Capped at 100 — drives the ring geometry. */
  percentage: number;
  /** Uncapped — what gets displayed. */
  rawPercentage: number;
  daysLeft: number;
  /** Income not committed to any section. Negative means over-committed. */
  unallocated: number;
}

function toItem(category: string, allocated: number, spent: number): UtilizationItem {
  const rawPercentage = allocated > 0 ? (spent / allocated) * 100 : 0;
  return {
    category,
    allocated,
    spent,
    remaining: allocated - spent,
    percentage: Math.min(rawPercentage, 100),
    rawPercentage,
  };
}

function rollUp(items: UtilizationItem[], key: SectionKey, extraSpent = 0): UtilizationSection {
  const allocated = items.reduce((sum, i) => sum + i.allocated, 0);
  const spent = items.reduce((sum, i) => sum + i.spent, 0) + extraSpent;
  const rawPercentage = allocated > 0 ? (spent / allocated) * 100 : 0;
  return {
    key,
    label: SECTION_META[key].label,
    color: SECTION_META[key].color,
    allocated,
    spent,
    remaining: allocated - spent,
    percentage: Math.min(rawPercentage, 100),
    rawPercentage,
    items,
  };
}

const normalize = (value: string | undefined) => (value ?? '').trim().toLowerCase();

/**
 * Splits a budget into its sections and measures each one against real spending.
 *
 * Pass an empty `expenses` array to get allocations only — useful for the budget
 * list, which plans rather than tracks.
 */
export function computeBudgetUtilization(
  budget: Budget,
  expenses: ExpenseLike[]
): { sections: UtilizationSection[]; totals: BudgetTotals } {
  const start = new Date(budget.startDate).getTime();
  const end = new Date(budget.endDate).setHours(23, 59, 59, 999);
  const inPeriod = expenses.filter(e => {
    const at = new Date(e.date).getTime();
    return at >= start && at <= end;
  });

  const spentIn = (categoryName: string) =>
    inPeriod.filter(e => e.category === categoryName).reduce((sum, e) => sum + e.amount, 0);

  const budgetSubs = budget.subscriptions ?? [];
  const days = periodDays(budget.startDate, budget.endDate);

  // With a dedicated subscriptions section, a plain "Subscriptions" spending
  // line would double-count the same money — the section supersedes it.
  const expenseAllocations = budgetSubs.length > 0
    ? budget.categories.filter(c => c.name !== SUBSCRIPTION_CATEGORY)
    : budget.categories;

  const subscriptionItems = budgetSubs.map(sub => {
    // Subscription payments are matched by description, which is exactly what
    // the quick-fill shortcut for a subscription writes.
    const spent = inPeriod
      .filter(e => e.category === SUBSCRIPTION_CATEGORY && normalize(e.description) === normalize(sub.name))
      .reduce((sum, e) => sum + e.amount, 0);
    return toItem(sub.name, subscriptionCostForPeriod(sub, days), spent);
  });

  // Subscription spending that matched no single line still belongs to the
  // section total — otherwise it would vanish from the budget entirely.
  const matchedSubSpend = subscriptionItems.reduce((sum, i) => sum + i.spent, 0);
  const unmatchedSubSpend = Math.max(0, spentIn(SUBSCRIPTION_CATEGORY) - matchedSubSpend);

  const sections: UtilizationSection[] = [
    rollUp(expenseAllocations.map(c => toItem(c.name, c.allocatedAmount, spentIn(c.name))), 'expenses'),
    rollUp((budget.investments ?? []).map(c => toItem(c.name, c.allocatedAmount, spentIn(c.name))), 'investments'),
    rollUp((budget.savings ?? []).map(c => toItem(c.name, c.allocatedAmount, spentIn(c.name))), 'savings'),
    rollUp(subscriptionItems, 'subscriptions', unmatchedSubSpend),
  ];

  // Heaviest spend first inside each section; allocation breaks ties so a fresh
  // budget (everything at zero) still ranks by intent rather than arbitrarily.
  for (const section of sections) {
    section.items.sort((a, b) => b.spent - a.spent || b.allocated - a.allocated);
  }

  const allocated = sections.reduce((sum, s) => sum + s.allocated, 0);
  const spent = sections.reduce((sum, s) => sum + s.spent, 0);
  const income = budget.income ?? 0;
  const msLeft = end - Date.now();

  return {
    sections,
    totals: {
      income,
      allocated,
      spent,
      remaining: allocated - spent,
      percentage: allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0,
      rawPercentage: allocated > 0 ? (spent / allocated) * 100 : 0,
      daysLeft: msLeft > 0 ? Math.ceil(msLeft / 86_400_000) : 0,
      unallocated: income - allocated,
    },
  };
}

/** Sections that carry at least one line — what's worth rendering. */
export function nonEmptySections(sections: UtilizationSection[]): UtilizationSection[] {
  return sections.filter(s => s.items.length > 0);
}
