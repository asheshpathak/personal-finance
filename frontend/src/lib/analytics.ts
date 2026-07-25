import { categoryGroup, type CategoryGroup } from './expenseCategories';

export interface AnalyticsExpense {
  _id: string;
  amount: number;
  category: string;
  paymentMode: string;
  description?: string;
  date: string;
}

export type PeriodKey =
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'LAST_3M'
  | 'LAST_6M'
  | 'THIS_YEAR'
  | 'LAST_12M'
  | 'ALL'
  | 'CUSTOM';

export const PERIOD_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'LAST_MONTH', label: 'Last month' },
  { key: 'LAST_3M', label: '3 months' },
  { key: 'LAST_6M', label: '6 months' },
  { key: 'THIS_YEAR', label: 'This year' },
  { key: 'LAST_12M', label: '12 months' },
  { key: 'ALL', label: 'All time' },
  { key: 'CUSTOM', label: 'Custom' },
];

export interface AnalyticsFilters {
  period: PeriodKey;
  /** `YYYY-MM-DD`, only read when period is CUSTOM. */
  customStart: string;
  customEnd: string;
  /** Empty means "no restriction" for each of these. */
  categories: string[];
  paymentModes: string[];
  groups: CategoryGroup[];
}

export function defaultFilters(): AnalyticsFilters {
  return {
    period: 'LAST_3M',
    customStart: '',
    customEnd: '',
    categories: [],
    paymentModes: [],
    groups: [],
  };
}

export interface DateRange {
  /** Local midnight on the first day. */
  start: Date;
  /** Local end-of-day on the last day, so same-day expenses are included. */
  end: Date;
}

const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
const endOfDay = (d: Date) => { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; };
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const addMonths = (d: Date, n: number) => { const c = new Date(d); c.setMonth(c.getMonth() + n); return c; };

/** Inclusive day count of a range. */
export function rangeDays(range: DateRange): number {
  return Math.max(1, Math.round((startOfDay(range.end).getTime() - startOfDay(range.start).getTime()) / DAY_MS) + 1);
}

/**
 * Turns a preset into concrete dates. `ALL` needs the data to know where the
 * history starts, so the expense list is passed in rather than assumed.
 */
export function resolvePeriod(filters: AnalyticsFilters, expenses: AnalyticsExpense[]): DateRange {
  const today = new Date();

  switch (filters.period) {
    case 'THIS_MONTH':
      return {
        start: startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: endOfDay(today),
      };
    case 'LAST_MONTH':
      return {
        start: startOfDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        end: endOfDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case 'LAST_3M':
      return { start: startOfDay(addDays(addMonths(today, -3), 1)), end: endOfDay(today) };
    case 'LAST_6M':
      return { start: startOfDay(addDays(addMonths(today, -6), 1)), end: endOfDay(today) };
    case 'THIS_YEAR':
      return { start: startOfDay(new Date(today.getFullYear(), 0, 1)), end: endOfDay(today) };
    case 'LAST_12M':
      return { start: startOfDay(addDays(addMonths(today, -12), 1)), end: endOfDay(today) };
    case 'CUSTOM': {
      const start = filters.customStart ? new Date(`${filters.customStart}T00:00:00`) : addMonths(today, -1);
      const end = filters.customEnd ? new Date(`${filters.customEnd}T00:00:00`) : today;
      // Tolerate a backwards range instead of rendering an empty page.
      return start <= end
        ? { start: startOfDay(start), end: endOfDay(end) }
        : { start: startOfDay(end), end: endOfDay(start) };
    }
    case 'ALL':
    default: {
      const earliest = expenses.reduce<number | null>((min, e) => {
        const at = new Date(e.date).getTime();
        return min === null || at < min ? at : min;
      }, null);
      return {
        start: startOfDay(earliest === null ? addMonths(today, -1) : new Date(earliest)),
        end: endOfDay(today),
      };
    }
  }
}

/** The equally long stretch immediately before `range`, for like-for-like deltas. */
export function previousRange(range: DateRange): DateRange {
  const days = rangeDays(range);
  const end = endOfDay(addDays(startOfDay(range.start), -1));
  return { start: startOfDay(addDays(end, -(days - 1))), end };
}

function inRange(expense: AnalyticsExpense, range: DateRange): boolean {
  const at = new Date(expense.date).getTime();
  return at >= range.start.getTime() && at <= range.end.getTime();
}

/** Applies the dimension filters only — the date range is handled separately. */
function matchesDimensions(expense: AnalyticsExpense, filters: AnalyticsFilters): boolean {
  if (filters.categories.length > 0 && !filters.categories.includes(expense.category)) return false;
  if (filters.paymentModes.length > 0 && !filters.paymentModes.includes(expense.paymentMode)) return false;
  if (filters.groups.length > 0 && !filters.groups.includes(categoryGroup(expense.category))) return false;
  return true;
}

export type Granularity = 'day' | 'week' | 'month';

/** Buckets wide enough to read, narrow enough to show shape. */
export function granularityFor(range: DateRange): Granularity {
  const days = rangeDays(range);
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday-anchored, matching how most people think about a spending week. */
function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  const shift = (c.getDay() + 6) % 7;
  return addDays(c, -shift);
}

function bucketStart(date: Date, granularity: Granularity): Date {
  if (granularity === 'day') return startOfDay(date);
  if (granularity === 'week') return startOfWeek(date);
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

function nextBucket(date: Date, granularity: Granularity): Date {
  if (granularity === 'day') return addDays(date, 1);
  if (granularity === 'week') return addDays(date, 7);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function bucketLabel(date: Date, granularity: Granularity): string {
  if (granularity === 'month') return `${MONTHS_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

export interface TrendPoint {
  label: string;
  /** Total in this bucket of the selected period. */
  current: number;
  /** Total in the matching bucket of the previous period, aligned by position. */
  previous: number | null;
  /** Running total across the selected period. */
  cumulative: number;
}

/**
 * One point per bucket, zero-filled across the whole range so a quiet week reads
 * as a dip rather than disappearing from the axis.
 */
function buildTrend(
  current: AnalyticsExpense[],
  previous: AnalyticsExpense[],
  range: DateRange,
  previous_range: DateRange,
  granularity: Granularity
): TrendPoint[] {
  const totalsFor = (expenses: AnalyticsExpense[]) => {
    const totals = new Map<number, number>();
    for (const e of expenses) {
      const key = bucketStart(new Date(e.date), granularity).getTime();
      totals.set(key, (totals.get(key) ?? 0) + e.amount);
    }
    return totals;
  };

  const currentTotals = totalsFor(current);
  const previousTotals = totalsFor(previous);

  const buckets: Date[] = [];
  for (let at = bucketStart(range.start, granularity); at <= range.end; at = nextBucket(at, granularity)) {
    buckets.push(at);
  }

  const previousBuckets: Date[] = [];
  for (let at = bucketStart(previous_range.start, granularity); at <= previous_range.end; at = nextBucket(at, granularity)) {
    previousBuckets.push(at);
  }

  let running = 0;
  return buckets.map((at, i) => {
    const value = currentTotals.get(at.getTime()) ?? 0;
    running += value;
    // Align by position: bucket 3 of this period sits against bucket 3 of the
    // previous one, which is what makes the two lines comparable.
    const twin = previousBuckets[i];
    return {
      label: bucketLabel(at, granularity),
      current: value,
      previous: twin ? previousTotals.get(twin.getTime()) ?? 0 : null,
      cumulative: running,
    };
  });
}

export interface CategoryStat {
  category: string;
  group: CategoryGroup;
  amount: number;
  /** Percentage of the period's total. */
  share: number;
  transactions: number;
  previousAmount: number;
  /** Percent change vs the previous period; null when there's no baseline. */
  delta: number | null;
}

function sumBy<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function buildCategoryStats(current: AnalyticsExpense[], previous: AnalyticsExpense[]): CategoryStat[] {
  const total = sumBy(current, e => e.amount);
  const previousByCategory = new Map<string, number>();
  for (const e of previous) {
    previousByCategory.set(e.category, (previousByCategory.get(e.category) ?? 0) + e.amount);
  }

  const grouped = new Map<string, { amount: number; transactions: number }>();
  for (const e of current) {
    const entry = grouped.get(e.category) ?? { amount: 0, transactions: 0 };
    entry.amount += e.amount;
    entry.transactions += 1;
    grouped.set(e.category, entry);
  }

  return [...grouped.entries()]
    .map(([category, { amount, transactions }]) => {
      const previousAmount = previousByCategory.get(category) ?? 0;
      return {
        category,
        group: categoryGroup(category),
        amount,
        share: total > 0 ? (amount / total) * 100 : 0,
        transactions,
        previousAmount,
        delta: percentChange(amount, previousAmount),
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface Slice {
  name: string;
  amount: number;
  share: number;
  transactions: number;
}

function buildSlices(expenses: AnalyticsExpense[], key: (e: AnalyticsExpense) => string): Slice[] {
  const total = sumBy(expenses, e => e.amount);
  const grouped = new Map<string, { amount: number; transactions: number }>();
  for (const e of expenses) {
    const name = key(e);
    const entry = grouped.get(name) ?? { amount: 0, transactions: 0 };
    entry.amount += e.amount;
    entry.transactions += 1;
    grouped.set(name, entry);
  }
  return [...grouped.entries()]
    .map(([name, { amount, transactions }]) => ({
      name,
      amount,
      transactions,
      share: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Spelled out for prose — axis ticks stay abbreviated, sentences don't. */
export const WEEKDAY_NAMES: Record<string, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
  Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};

const plural = (day: string) => `${WEEKDAY_NAMES[day] ?? day}s`;

export interface WeekdayStat {
  day: string;
  total: number;
  /** Total divided by how many of that weekday the range actually contains. */
  average: number;
  transactions: number;
}

function buildWeekdayPattern(expenses: AnalyticsExpense[], range: DateRange): WeekdayStat[] {
  const totals = WEEKDAYS.map(() => ({ total: 0, transactions: 0 }));
  for (const e of expenses) {
    // getDay() is Sunday-first; shift so the week starts on Monday.
    const index = (new Date(e.date).getDay() + 6) % 7;
    totals[index].total += e.amount;
    totals[index].transactions += 1;
  }

  // Count real occurrences: a 10-day range holds two Mondays but one Wednesday,
  // and dividing by 7 either way would misrank the days.
  const occurrences = WEEKDAYS.map(() => 0);
  for (let at = startOfDay(range.start); at <= range.end; at = addDays(at, 1)) {
    occurrences[(at.getDay() + 6) % 7] += 1;
  }

  return WEEKDAYS.map((day, i) => ({
    day,
    total: totals[i].total,
    transactions: totals[i].transactions,
    average: occurrences[i] > 0 ? totals[i].total / occurrences[i] : 0,
  }));
}

export interface Kpi {
  label: string;
  value: number;
  previous: number;
  delta: number | null;
  /** Formatting hint for the view — money or a plain count. */
  format: 'currency' | 'count';
  hint: string;
}

export interface Insight {
  id: string;
  /** Rendered as "<lead> <body>", with the lead emphasised. */
  lead: string;
  body: string;
  tone: 'neutral' | 'up' | 'down';
}

export interface AnalyticsResult {
  range: DateRange;
  previousRange: DateRange;
  granularity: Granularity;
  /** Expenses inside the range after every filter. */
  expenses: AnalyticsExpense[];
  total: number;
  kpis: Kpi[];
  trend: TrendPoint[];
  categories: CategoryStat[];
  paymentModes: Slice[];
  groups: Slice[];
  weekdays: WeekdayStat[];
  topExpenses: AnalyticsExpense[];
  insights: Insight[];
}

/** Renders a figure for prose. The page passes its currency formatter in. */
export type ValueFormatter = (value: number) => string;

function buildInsights(
  current: AnalyticsExpense[],
  total: number,
  previousTotal: number,
  categories: CategoryStat[],
  weekdays: WeekdayStat[],
  days: number,
  money: ValueFormatter
): Insight[] {
  const insights: Insight[] = [];

  const totalDelta = percentChange(total, previousTotal);
  if (totalDelta !== null && current.length > 0) {
    const up = totalDelta >= 0;
    insights.push({
      id: 'total',
      lead: `${Math.abs(Math.round(totalDelta))}% ${up ? 'more' : 'less'}`,
      body: `than the previous ${days} days.`,
      tone: up ? 'up' : 'down',
    });
  }

  const top = categories[0];
  if (top) {
    insights.push({
      id: 'top-category',
      lead: top.category,
      body: `is your largest category at ${Math.round(top.share)}% of the total${
        top.share >= 40 ? ' — most of your spending sits in one place.' : '.'
      }`,
      tone: 'neutral',
    });
  }

  // The category that moved the most in absolute terms, which is the one worth
  // looking at — a 300% jump on a tiny category rarely matters.
  const movers = categories
    .filter(c => c.previousAmount > 0 && c.delta !== null)
    .sort((a, b) => Math.abs(b.amount - b.previousAmount) - Math.abs(a.amount - a.previousAmount));
  const mover = movers[0];
  if (mover && Math.abs(mover.amount - mover.previousAmount) > 0) {
    const up = mover.amount >= mover.previousAmount;
    insights.push({
      id: 'mover',
      lead: `${mover.category} ${up ? 'rose' : 'fell'} ${Math.abs(Math.round(mover.delta!))}%`,
      body: `— the biggest change of any category, ${money(Math.abs(mover.amount - mover.previousAmount))} ${up ? 'more' : 'less'} than last period.`,
      tone: up ? 'up' : 'down',
    });
  }

  const busiest = [...weekdays].sort((a, b) => b.average - a.average)[0];
  if (busiest && busiest.average > 0) {
    insights.push({
      id: 'weekday',
      lead: `${plural(busiest.day)} cost the most`,
      body: `at ${money(busiest.average)} on an average one.`,
      tone: 'neutral',
    });
  }

  return insights.slice(0, 4);
}

/**
 * The single entry point: applies filters, then derives every figure the
 * analytics page shows so the charts, stats and tables can never disagree.
 */
export function analyze(
  expenses: AnalyticsExpense[],
  filters: AnalyticsFilters,
  /** Used only for figures embedded in insight prose. */
  money: ValueFormatter = value => String(Math.round(value))
): AnalyticsResult {
  const range = resolvePeriod(filters, expenses);
  const prev = previousRange(range);

  const dimensionMatched = expenses.filter(e => matchesDimensions(e, filters));
  const current = dimensionMatched.filter(e => inRange(e, range));
  const previous = dimensionMatched.filter(e => inRange(e, prev));

  const total = sumBy(current, e => e.amount);
  const previousTotal = sumBy(previous, e => e.amount);
  const days = rangeDays(range);
  const previousDays = rangeDays(prev);

  const granularity = granularityFor(range);
  const categories = buildCategoryStats(current, previous);
  const weekdays = buildWeekdayPattern(current, range);

  const avg = current.length > 0 ? total / current.length : 0;
  const previousAvg = previous.length > 0 ? previousTotal / previous.length : 0;

  const kpis: Kpi[] = [
    {
      label: 'Total',
      value: total,
      previous: previousTotal,
      delta: percentChange(total, previousTotal),
      format: 'currency',
      hint: `across ${days} days`,
    },
    {
      label: 'Per day',
      value: total / days,
      previous: previousTotal / previousDays,
      delta: percentChange(total / days, previousTotal / previousDays),
      format: 'currency',
      hint: 'average daily spend',
    },
    {
      label: 'Transactions',
      value: current.length,
      previous: previous.length,
      delta: percentChange(current.length, previous.length),
      format: 'count',
      hint: `${categories.length} categories`,
    },
    {
      label: 'Per transaction',
      value: avg,
      previous: previousAvg,
      delta: percentChange(avg, previousAvg),
      format: 'currency',
      hint: 'average payment',
    },
  ];

  return {
    range,
    previousRange: prev,
    granularity,
    expenses: current,
    total,
    kpis,
    trend: buildTrend(current, previous, range, prev, granularity),
    categories,
    paymentModes: buildSlices(current, e => e.paymentMode || 'Unspecified'),
    groups: buildSlices(current, e => categoryGroup(e.category)),
    weekdays,
    topExpenses: [...current].sort((a, b) => b.amount - a.amount).slice(0, 8),
    insights: buildInsights(current, total, previousTotal, categories, weekdays, days, money),
  };
}

/** "Jul 1 – Jul 31, 2026" */
export function formatRange(range: DateRange): string {
  const start = range.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end = range.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${start} – ${end}`;
}
