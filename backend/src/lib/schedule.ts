/**
 * Billing-schedule maths for subscriptions.
 *
 * Everything here speaks in `YYYY-MM-DD` day keys, never instants. A billing
 * occurrence is a calendar day — "the 5th of the month" — and the moment that
 * is turned into a UTC timestamp it can slide to the 4th or the 6th depending
 * on where the reader is. Day keys sort lexicographically, compare exactly, and
 * have no timezone at all, so the same subscription bills on the same day
 * whether the server is in Mumbai or Virginia.
 *
 * Dates are used only as scratch space for arithmetic, always constructed with
 * UTC parts so no local offset can leak in.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const pad = (n: number) => String(n).padStart(2, '0');

export const isDayKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Day key for a UTC-normalised date. */
export function toDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A `YYYY-MM-DD` key as a UTC-midnight Date, for arithmetic only. */
export function fromDayKey(key: string): Date {
  const [y = NaN, m = NaN, d = NaN] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export const addDaysKey = (key: string, days: number): string => {
  const d = fromDayKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toDayKey(d);
};

export const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * The nth day of a month, clamped to the month's length.
 *
 * A subscription due on the 31st has to bill on Feb 28 rather than skipping
 * February or spilling into March — the same clamping every real biller does.
 */
export function dayInMonth(year: number, monthIndex: number, day: number): string {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
  return `${year}-${pad(monthIndex + 1)}-${pad(clamped)}`;
}

export interface Schedule {
  frequency: Frequency;
  // `| undefined` is spelled out because the project runs with
  // exactOptionalPropertyTypes: an absent field and a field explicitly set to
  // undefined are different types, and Mongoose documents hand back the latter.
  dueDayOfWeek?: string | null | undefined;
  dueDayOfMonth?: number | null | undefined;
  dueMonth?: number | null | undefined;
}

/**
 * The first billing day on or after `from` for a schedule.
 *
 * Returns null when the schedule can't produce a date — a weekly subscription
 * with no weekday set, say — rather than guessing one.
 */
export function firstDueOnOrAfter(schedule: Schedule, from: string): string | null {
  if (!isDayKey(from)) return null;

  switch (schedule.frequency) {
    case 'daily':
      return from;

    case 'weekly': {
      const target = DAY_INDEX[String(schedule.dueDayOfWeek ?? '').toLowerCase()];
      if (target === undefined) return null;
      const current = fromDayKey(from).getUTCDay();
      return addDaysKey(from, (target - current + 7) % 7);
    }

    case 'monthly': {
      const day = Number(schedule.dueDayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      const start = fromDayKey(from);
      const candidate = dayInMonth(start.getUTCFullYear(), start.getUTCMonth(), day);
      if (candidate >= from) return candidate;
      // Already past this month's date — roll to next month.
      const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      return dayInMonth(next.getUTCFullYear(), next.getUTCMonth(), day);
    }

    case 'yearly': {
      const day = Number(schedule.dueDayOfMonth);
      const month = Number(schedule.dueMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      if (!Number.isInteger(month) || month < 1 || month > 12) return null;
      const year = fromDayKey(from).getUTCFullYear();
      const candidate = dayInMonth(year, month - 1, day);
      return candidate >= from ? candidate : dayInMonth(year + 1, month - 1, day);
    }

    default:
      return null;
  }
}

export interface SubscriptionSchedule extends Schedule {
  startDay?: string | null | undefined;
  lastChargedDay?: string | null | undefined;
  pendingSchedule?: (Schedule & { frequency: Frequency }) | null | undefined;
  pendingEffectiveFrom?: string | null | undefined;
}

/** Guard against a pathological schedule spinning forever. */
const MAX_OCCURRENCES = 400;

/**
 * Resolves one subscription into "given a day to search from, when does it next
 * bill?" — honouring a staged due-date change.
 *
 * The crossover is the subtle part, and getting it wrong is what makes a
 * rescheduled subscription skip a month or bill twice. The rule: the schedule
 * that applies is decided by where the *occurrence* lands, not by where the
 * search started. So if the old cadence would next bill on Sept 20 but the
 * change takes effect Sept 1, the answer is not "Sept 20" and not "the next
 * pending date after Sept 20" — it is the first pending date from Sept 1, which
 * is the cycle that day belongs to.
 */
function occurrenceResolver(subscription: SubscriptionSchedule): (searchFrom: string) => string | null {
  const live: Schedule = {
    frequency: subscription.frequency,
    dueDayOfWeek: subscription.dueDayOfWeek,
    dueDayOfMonth: subscription.dueDayOfMonth,
    dueMonth: subscription.dueMonth,
  };
  const pending = subscription.pendingSchedule ?? null;
  const effectiveFrom = isDayKey(subscription.pendingEffectiveFrom)
    ? subscription.pendingEffectiveFrom
    : null;

  return (searchFrom: string): string | null => {
    if (!isDayKey(searchFrom)) return null;

    // Past the changeover already — only the new schedule exists.
    if (pending && effectiveFrom && searchFrom >= effectiveFrom) {
      return firstDueOnOrAfter(pending, searchFrom);
    }

    const candidate = firstDueOnOrAfter(live, searchFrom);

    // The old schedule's next date falls on or after the changeover, so that
    // cycle is already the new schedule's. Re-anchor at the effective date
    // rather than carrying the old cadence across it.
    if (pending && effectiveFrom && (candidate === null || candidate >= effectiveFrom)) {
      return firstDueOnOrAfter(pending, effectiveFrom);
    }

    return candidate;
  };
}

/** Where a subscription resumes billing: the day after its last charge, else its start. */
function resumeFrom(subscription: SubscriptionSchedule): string | null {
  const last = isDayKey(subscription.lastChargedDay) ? subscription.lastChargedDay : null;
  const start = isDayKey(subscription.startDay) ? subscription.startDay : null;
  if (last) return addDaysKey(last, 1);
  return start;
}

/**
 * Every billing day from where the subscription left off through `today`,
 * inclusive.
 *
 * The walk starts at the day *after* whatever was last charged, so a run is
 * safe to repeat: already-billed days are never revisited. A brand-new
 * subscription starts from `startDay`, which is why adding one today doesn't
 * back-fill history.
 *
 * Each step searches from the day after the occurrence just found, which is
 * what lets a staged change take over mid-walk even when several cycles are
 * being caught up at once.
 */
export function dueDaysThrough(subscription: SubscriptionSchedule, today: string): { days: string[] } {
  const from = resumeFrom(subscription);
  if (!from || !isDayKey(today)) return { days: [] };

  const nextOccurrence = occurrenceResolver(subscription);
  const days: string[] = [];

  let searchFrom = from;
  while (days.length < MAX_OCCURRENCES) {
    const due = nextOccurrence(searchFrom);
    // A schedule that can't produce a date (no weekday set, say) stops here
    // rather than looping.
    if (!due || due > today) break;
    days.push(due);
    searchFrom = addDaysKey(due, 1);
  }

  return { days };
}

/**
 * The next day this subscription will bill.
 *
 * Display only — the charger derives its own dates from the same resolver, so
 * the two can never disagree. Reflects a staged change, which is what lets the
 * UI say "next charge moves to the 12th".
 */
export function nextDueDay(subscription: SubscriptionSchedule, today: string): string | null {
  const from = resumeFrom(subscription);
  if (!from) return null;
  // Never look behind today: anything older than that is a charge in arrears,
  // which the catch-up run posts rather than something still "upcoming".
  return occurrenceResolver(subscription)(from > today ? from : today);
}

/**
 * The first day a due-date change may take effect: the start of the cycle after
 * the one currently in progress.
 *
 * For a monthly subscription that is the 1st of next month — the "takes effect
 * next month" rule the user asked for — and the equivalent boundary for the
 * other cadences, so a weekly change lands next week rather than next month.
 */
export function nextCycleStart(frequency: Frequency, today: string): string {
  const d = fromDayKey(today);

  switch (frequency) {
    case 'daily':
      return addDaysKey(today, 1);
    case 'weekly':
      return addDaysKey(today, 7 - ((d.getUTCDay() + 6) % 7)); // next Monday
    case 'monthly':
      return toDayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    case 'yearly':
      return toDayKey(new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)));
    default:
      return addDaysKey(today, 1);
  }
}

/** True when two schedules would bill on different days. */
export function scheduleChanged(a: Schedule, b: Schedule): boolean {
  return (
    a.frequency !== b.frequency ||
    (a.dueDayOfWeek ?? null) !== (b.dueDayOfWeek ?? null) ||
    (a.dueDayOfMonth ?? null) !== (b.dueDayOfMonth ?? null) ||
    (a.dueMonth ?? null) !== (b.dueMonth ?? null)
  );
}
