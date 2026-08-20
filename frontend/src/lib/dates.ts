/**
 * Local-calendar date helpers.
 *
 * Everything user-facing in this app is a *calendar day*, not an instant. The
 * moment you route a day through `toISOString()` you have shifted it into UTC,
 * and for anyone west of Greenwich that lands on the previous day. So the rule
 * here is: days are `YYYY-MM-DD` strings built from local getters, and Dates are
 * only used for arithmetic in between.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a Date, read in the local calendar. */
export function toDayKey(value: Date | string = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` key. Invalid input yields an Invalid Date. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

export const isValidDayKey = (key: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(fromDayKey(key).getTime());

export const startOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

export const endOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
};

export const addDays = (d: Date, n: number): Date => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

/**
 * Month arithmetic that clamps instead of overflowing. Plain `setMonth` turns
 * Jan 31 + 1 month into Mar 3; here it becomes Feb 28.
 */
export const addMonths = (d: Date, n: number): Date => {
  const day = d.getDate();
  const c = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  c.setDate(Math.min(day, daysInMonth(c.getFullYear(), c.getMonth())));
  return c;
};

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate();

/** Monday-anchored — how most people picture a spending week. */
export const startOfWeek = (d: Date): Date => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Inclusive whole-day span between two days; never less than 1. */
export function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_NAMES_SHORT = MONTH_NAMES.map(m => m.slice(0, 3));

/** Monday-first, matching `startOfWeek`. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** "Mar 4, 2026" */
export function formatDay(value: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
}

/** "Mar 4 – Mar 31, 2026", dropping the repeated year and month where it reads better. */
export function formatDayRange(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  const start = from.toLocaleDateString('en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  const end = to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${start} – ${end}`;
}

/**
 * The 42 cells of a Monday-first month grid — six full weeks, so the calendar
 * never changes height as you page through months.
 */
export function monthGrid(year: number, monthIndex: number): Date[] {
  const first = new Date(year, monthIndex, 1);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Ordinal day-of-month: 1st, 2nd, 3rd, 21st… */
export function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

/** "in 3 days" / "today" / "5 days ago" — relative to local midnight. */
export function relativeDay(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 0) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

/** A pair of `YYYY-MM-DD` day keys; empty strings mean unset. */
export interface DateRange {
  from: string;
  to: string;
}

/** "Mar 4 – Mar 31, 2026", or a half-open range while one is being drawn. */
export function formatRangeLabel(range: DateRange, placeholder = 'Custom range'): string {
  const fromValid = isValidDayKey(range.from);
  const toValid = isValidDayKey(range.to);
  if (fromValid && toValid) return formatDayRange(fromDayKey(range.from), fromDayKey(range.to));
  if (fromValid) return `${formatDay(fromDayKey(range.from))} – …`;
  return placeholder;
}
