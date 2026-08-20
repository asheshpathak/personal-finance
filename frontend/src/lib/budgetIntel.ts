import { categoryGroup, type CategoryGroup } from './expenseCategories';
import { addMonths, startOfMonth, toDayKey } from './dates';

/**
 * Spending intelligence: what history says a category actually costs.
 *
 * This is the shared brain behind two features — the suggestions offered while
 * planning a budget, and the "what should next month look like" guidance on the
 * snapshots page. Both have to answer the same question, so they answer it from
 * the same place rather than drifting apart.
 *
 * Everything here is descriptive statistics over the user's own history. No
 * model, no server call: it runs on expenses already loaded, which is what
 * makes it feel instant while typing.
 */

export interface IntelExpense {
  amount: number;
  category: string;
  date: string;
  description?: string;
}

/** Average days in a month, for scaling a monthly figure to any period. */
export const AVG_MONTH_DAYS = 30.437;

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export interface CategoryStats {
  category: string;
  group: CategoryGroup;
  /** Per-month totals, oldest first, zero-filled across the observed window. */
  monthly: { month: string; amount: number }[];
  /** Distinct months in which anything was spent. */
  monthsWithSpend: number;
  /** Months in the window, spent or not — the denominator for "how regular". */
  monthsObserved: number;
  total: number;
  /** Mean across observed months, including zero months. */
  mean: number;
  /**
   * Median across observed months. The headline figure: a single holiday or an
   * annual insurance bill drags a mean upward and would have you budgeting for
   * a spike that happens once a year.
   */
  median: number;
  /** 75th percentile — the "comfortable" number, for volatile categories. */
  p75: number;
  /** The most recent complete month's total. */
  lastMonth: number;
  /** Mean of the three most recent months. */
  recentMean: number;
  /** Coefficient of variation. Above ~0.6 the category is genuinely erratic. */
  volatility: number;
  /**
   * Direction of travel: fraction by which the recent half of the window
   * differs from the earlier half. +0.2 means spending is up about 20%.
   */
  trend: number;
  transactions: number;
  /** How often it appears — 1 means every observed month. */
  regularity: number;
  lastSeen: string | null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base] ?? 0;
  const upper = sorted[base + 1] ?? lower;
  return lower + rest * (upper - lower);
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Per-category statistics over the last `months` complete months.
 *
 * The current month is excluded on purpose: it is partial, and a budget built
 * from "so far this month" systematically under-plans. Only whole months make
 * an honest baseline.
 */
export function buildCategoryStats(
  expenses: IntelExpense[],
  months = 6,
  now: Date = new Date()
): Map<string, CategoryStats> {
  const currentMonthStart = startOfMonth(now);
  const windowStart = addMonths(currentMonthStart, -months);

  // The month labels in the window, oldest first — the zero-fill skeleton, so a
  // month with no spending counts as a real zero rather than vanishing.
  const window: string[] = [];
  for (let i = months; i >= 1; i--) window.push(monthKey(addMonths(currentMonthStart, -i)));

  const byCategory = new Map<string, {
    perMonth: Map<string, number>;
    transactions: number;
    lastSeen: string | null;
  }>();

  for (const expense of expenses) {
    const at = new Date(expense.date);
    if (Number.isNaN(at.getTime())) continue;
    if (at < windowStart || at >= currentMonthStart) continue;

    const key = monthKey(at);
    const entry = byCategory.get(expense.category) ?? {
      perMonth: new Map<string, number>(),
      transactions: 0,
      lastSeen: null,
    };
    entry.perMonth.set(key, (entry.perMonth.get(key) ?? 0) + expense.amount);
    entry.transactions += 1;
    const day = toDayKey(at);
    if (!entry.lastSeen || day > entry.lastSeen) entry.lastSeen = day;
    byCategory.set(expense.category, entry);
  }

  const stats = new Map<string, CategoryStats>();

  for (const [category, entry] of byCategory) {
    const monthly = window.map(month => ({ month, amount: entry.perMonth.get(month) ?? 0 }));
    const amounts = monthly.map(m => m.amount);
    const sorted = [...amounts].sort((a, b) => a - b);
    const total = amounts.reduce((sum, v) => sum + v, 0);
    const avg = mean(amounts);

    const half = Math.floor(monthly.length / 2);
    const earlier = mean(amounts.slice(0, half));
    const recent = mean(amounts.slice(half));

    const variance = mean(amounts.map(v => (v - avg) ** 2));
    const monthsWithSpend = amounts.filter(v => v > 0).length;

    stats.set(category, {
      category,
      group: categoryGroup(category),
      monthly,
      monthsWithSpend,
      monthsObserved: monthly.length,
      total,
      mean: avg,
      median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      lastMonth: monthly[monthly.length - 1]?.amount ?? 0,
      recentMean: mean(amounts.slice(-3)),
      volatility: avg > 0 ? Math.sqrt(variance) / avg : 0,
      trend: earlier > 0 ? (recent - earlier) / earlier : 0,
      transactions: entry.transactions,
      regularity: monthly.length > 0 ? monthsWithSpend / monthly.length : 0,
      lastSeen: entry.lastSeen,
    });
  }

  return stats;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  category: string;
  group: CategoryGroup;
  /** Recommended allocation, already scaled to the budget's period length. */
  amount: number;
  confidence: Confidence;
  /** One sentence explaining where the number came from. */
  rationale: string;
  /** Supporting figures, scaled to the same period, for a compact display. */
  median: number;
  lastMonth: number;
  recentMean: number;
  trend: number;
  monthsWithSpend: number;
  monthsObserved: number;
}

/** Rounds to a increment that looks deliberate rather than computed. */
function tidy(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < 50) return Math.ceil(amount / 5) * 5;
  if (amount < 500) return Math.ceil(amount / 10) * 10;
  if (amount < 5000) return Math.ceil(amount / 50) * 50;
  return Math.ceil(amount / 100) * 100;
}

const pct = (value: number) => `${Math.round(Math.abs(value) * 100)}%`;

/**
 * What to budget for one category over a period of `days`.
 *
 * The base is the **median** month, not the mean: one holiday or one annual
 * premium pulls a mean up by half and would have you setting aside money for a
 * spike that happens once a year. From there:
 *
 *  · a category trending up gets the recent average instead, because the median
 *    of a rising series is already out of date;
 *  · an erratic category gets the 75th percentile, so a normal-but-heavy month
 *    doesn't immediately blow the budget;
 *  · an occasional category is quoted at what it costs *when it happens*, since
 *    averaging across empty months would under-fund every month it does.
 */
export function suggestAllocation(stats: CategoryStats, days: number): Suggestion {
  const scale = days / AVG_MONTH_DAYS;
  const occasional = stats.regularity < 0.5 && stats.monthsWithSpend > 0;
  const erratic = stats.volatility > 0.6;
  const rising = stats.trend > 0.15;
  const falling = stats.trend < -0.15;

  let monthlyBase: number;
  let reason: string;

  if (occasional) {
    // Average of the months it actually appeared in — the cost of an occurrence.
    const spentMonths = stats.monthly.filter(m => m.amount > 0).map(m => m.amount);
    monthlyBase = mean(spentMonths);
    reason = `Appears in ${stats.monthsWithSpend} of the last ${stats.monthsObserved} months — this is what it costs when it does.`;
  } else if (rising) {
    monthlyBase = Math.max(stats.recentMean, stats.median);
    reason = `Up ${pct(stats.trend)} over the window, so this follows your recent 3-month average rather than the older median.`;
  } else if (erratic) {
    monthlyBase = stats.p75;
    reason = `Swings a lot month to month, so this is set at your 75th-percentile month to leave headroom.`;
  } else if (falling) {
    monthlyBase = Math.min(stats.recentMean, stats.median);
    reason = `Down ${pct(stats.trend)} recently — planned at the lower of your recent average and your median.`;
  } else {
    monthlyBase = stats.median;
    reason = `Steady at about your median month across ${stats.monthsObserved} months.`;
  }

  const confidence: Confidence =
    stats.monthsWithSpend >= 4 && !erratic ? 'high'
    : stats.monthsWithSpend >= 2 ? 'medium'
    : 'low';

  return {
    category: stats.category,
    group: stats.group,
    amount: tidy(monthlyBase * scale),
    confidence,
    rationale: reason,
    median: stats.median * scale,
    lastMonth: stats.lastMonth * scale,
    recentMean: stats.recentMean * scale,
    trend: stats.trend,
    monthsWithSpend: stats.monthsWithSpend,
    monthsObserved: stats.monthsObserved,
  };
}

/**
 * Categories worth planning for that the budget doesn't cover yet.
 *
 * Ranked by money, not by frequency — the point is to catch the ₹8,000 hole,
 * not the category that shows up often but costs nothing. Anything already
 * planned, and anything that appeared only once and never again, is left out.
 */
export function missingCategories(
  stats: Map<string, CategoryStats>,
  alreadyPlanned: Iterable<string>,
  days: number,
  limit = 6
): Suggestion[] {
  const planned = new Set([...alreadyPlanned].map(name => name.trim().toLowerCase()));

  return [...stats.values()]
    .filter(s => !planned.has(s.category.trim().toLowerCase()))
    .filter(s => s.total > 0)
    // A single appearance months ago is history, not a pattern. Two or more —
    // or one recent enough to be live — is worth surfacing.
    .filter(s => s.monthsWithSpend >= 2 || s.lastMonth > 0)
    .map(s => suggestAllocation(s, days))
    .filter(s => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Every suggestion, keyed by category, for looking one up while typing. */
export function suggestionIndex(
  stats: Map<string, CategoryStats>,
  days: number
): Map<string, Suggestion> {
  const index = new Map<string, Suggestion>();
  for (const [category, s] of stats) index.set(category, suggestAllocation(s, days));
  return index;
}

/**
 * Total take-home implied by history, if it can be told. Returns null rather
 * than a guess — a fabricated income figure would silently distort every
 * "left unallocated" number on the page.
 */
export function totalSuggested(suggestions: Suggestion[]): number {
  return suggestions.reduce((sum, s) => sum + s.amount, 0);
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'Confident',
  medium: 'Fair',
  low: 'Thin data',
};
