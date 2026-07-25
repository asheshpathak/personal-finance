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
  /** Budgeted spend plus non-budgeted spend — everything paid in the period. */
  periodTotal: number;
}

export interface UnbudgetedCategory {
  category: string;
  amount: number;
  transactions: number;
  /** Percentage of the non-budgeted total, not of the whole period. */
  share: number;
}

/** Spending inside the budget's dates that no allocation covers. */
export interface UnbudgetedSpend {
  total: number;
  transactions: number;
  categories: UnbudgetedCategory[];
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

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Period membership is decided on calendar days, not instants, because the two
 * kinds of date in this app are written differently:
 *
 * - a budget bound comes from a `YYYY-MM-DD` input, so it is stored at UTC
 *   midnight and its UTC day is the day that was picked;
 * - an expense is stored at *local* noon, so its local day is the day that was
 *   picked.
 *
 * Comparing the raw instants instead dropped the whole last day of a budget for
 * any reader west of UTC.
 */
const budgetBoundDay = (value: string) => new Date(value).toISOString().slice(0, 10);

const expenseDay = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Every expense inside a budget's period — budgeted for or not.
 *
 * This is the one definition of "in this budget's period"; utilization and the
 * dashboard headline both use it so they can't drift apart.
 */
export function expensesInPeriod<T extends { date: string }>(
  budget: { startDate: string; endDate: string },
  expenses: T[]
): T[] {
  const from = budgetBoundDay(budget.startDate);
  const to = budgetBoundDay(budget.endDate);
  return expenses.filter(e => {
    const day = expenseDay(e.date);
    return day >= from && day <= to;
  });
}

/**
 * Splits a budget into its sections and measures each one against real spending.
 *
 * Pass an empty `expenses` array to get allocations only — useful for the budget
 * list, which plans rather than tracks.
 */
export function computeBudgetUtilization(
  budget: Budget,
  expenses: ExpenseLike[]
): { sections: UtilizationSection[]; unbudgeted: UnbudgetedSpend; totals: BudgetTotals } {
  const inPeriod = expensesInPeriod(budget, expenses);

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
  //
  // Only when the budget actually plans subscriptions, though: a budget that
  // plans none doesn't get to absorb subscription payments into a section with
  // no rows. That spending is simply outside the plan, and counting it here as
  // well as there inflated the period total.
  const matchedSubSpend = subscriptionItems.reduce((sum, i) => sum + i.spent, 0);
  const unmatchedSubSpend = budgetSubs.length > 0
    ? Math.max(0, spentIn(SUBSCRIPTION_CATEGORY) - matchedSubSpend)
    : 0;

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

  // Anything paid inside the period that no budget line covers. It isn't part
  // of utilization — you can't use an allocation that doesn't exist — but it is
  // real money, so it gets reported rather than dropped.
  const budgeted = new Set<string>([
    ...expenseAllocations.map(c => c.name),
    ...(budget.investments ?? []).map(c => c.name),
    ...(budget.savings ?? []).map(c => c.name),
  ]);
  if (budgetSubs.length > 0) budgeted.add(SUBSCRIPTION_CATEGORY);

  const unbudgetedExpenses = inPeriod.filter(e => !budgeted.has(e.category));
  const byCategory = new Map<string, { amount: number; transactions: number }>();
  for (const e of unbudgetedExpenses) {
    const entry = byCategory.get(e.category) ?? { amount: 0, transactions: 0 };
    entry.amount += e.amount;
    entry.transactions += 1;
    byCategory.set(e.category, entry);
  }
  const unbudgetedTotal = unbudgetedExpenses.reduce((sum, e) => sum + e.amount, 0);

  const unbudgeted: UnbudgetedSpend = {
    total: unbudgetedTotal,
    transactions: unbudgetedExpenses.length,
    categories: [...byCategory.entries()]
      .map(([category, entry]) => ({
        category,
        amount: entry.amount,
        transactions: entry.transactions,
        share: unbudgetedTotal > 0 ? (entry.amount / unbudgetedTotal) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
  };

  const allocated = sections.reduce((sum, s) => sum + s.allocated, 0);
  const spent = sections.reduce((sum, s) => sum + s.spent, 0);
  const income = budget.income ?? 0;
  // Counted to the end of the budget's last calendar day, in the reader's own
  // timezone — "2 days left" has to mean the same thing wherever it's read.
  const msLeft = new Date(`${budgetBoundDay(budget.endDate)}T23:59:59.999`).getTime() - Date.now();

  return {
    sections,
    unbudgeted,
    totals: {
      income,
      allocated,
      spent,
      remaining: allocated - spent,
      percentage: allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0,
      rawPercentage: allocated > 0 ? (spent / allocated) * 100 : 0,
      daysLeft: msLeft > 0 ? Math.ceil(msLeft / 86_400_000) : 0,
      unallocated: income - allocated,
      // Everything paid in the period: what the budget planned for, plus what
      // it didn't. This is the figure the dashboard headline shows.
      periodTotal: spent + unbudgeted.total,
    },
  };
}

/** Sections that carry at least one line — what's worth rendering. */
export function nonEmptySections(sections: UtilizationSection[]): UtilizationSection[] {
  return sections.filter(s => s.items.length > 0);
}
