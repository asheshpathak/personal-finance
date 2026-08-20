import type { Frequency } from './subscriptionTotals';
import type { DayOfWeek } from './subscriptionDueDate';
import { addDays, fromDayKey, isValidDayKey, toDayKey } from './dates';

/**
 * Enumerating the charges a subscription *will* make.
 *
 * The rest of the app answers "when is the next one" — the server derives that
 * and hands it over. Forecasting needs the whole list across a window, because
 * a projection that treats known future charges as random noise is worse than
 * one that treats them as what they are: arithmetic.
 *
 * That split is the single most important modelling decision in the forecast.
 * A month's total is a deterministic part plus a stochastic part, and only the
 * second one needs a model:
 *
 *     total = Σ scheduled charges + variable spend
 *
 * Everything here speaks `YYYY-MM-DD` day keys rather than instants, for the
 * same reason the rest of this app does: a billing occurrence is a calendar
 * day, and turning "the 5th" into a timestamp lets it slide to the 4th or the
 * 6th depending on where it is read.
 */

export interface ScheduledSubscription {
  _id?: string;
  name: string;
  amount: number;
  frequency: Frequency;
  category?: string;
  dueDayOfWeek?: DayOfWeek | null;
  dueDayOfMonth?: number | null;
  dueMonth?: number | null;
  autoRecord?: boolean;
  startDay?: string | null;
  lastChargedDay?: string | null;
}

export interface ScheduledCharge {
  /** `YYYY-MM-DD` the charge falls due. */
  day: string;
  amount: number;
  name: string;
  subscriptionId: string | null;
  category: string;
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const pad = (n: number) => String(n).padStart(2, '0');

const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();

/**
 * The nth day of a month, clamped to the month's length.
 *
 * A subscription due on the 31st bills on Feb 28 rather than skipping February
 * or spilling into March — the same clamping every real biller does, and the
 * same rule the server applies, so a projection and a posted charge agree.
 */
function dayInMonth(year: number, monthIndex: number, day: number): string {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
  return `${year}-${pad(monthIndex + 1)}-${pad(clamped)}`;
}

/** The first due day on or after `from`, or null when the schedule is incomplete. */
function firstDueOnOrAfter(sub: ScheduledSubscription, from: string): string | null {
  if (!isValidDayKey(from)) return null;
  const start = fromDayKey(from);

  switch (sub.frequency) {
    case 'daily':
      return from;

    case 'weekly': {
      if (!sub.dueDayOfWeek) return null;
      const target = DAY_INDEX[sub.dueDayOfWeek];
      if (target === undefined) return null;
      const shift = (target - start.getDay() + 7) % 7;
      return toDayKey(addDays(start, shift));
    }

    case 'monthly': {
      if (!sub.dueDayOfMonth) return null;
      const thisMonth = dayInMonth(start.getFullYear(), start.getMonth(), sub.dueDayOfMonth);
      if (thisMonth >= from) return thisMonth;
      const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return dayInMonth(next.getFullYear(), next.getMonth(), sub.dueDayOfMonth);
    }

    case 'yearly': {
      if (!sub.dueDayOfMonth || !sub.dueMonth) return null;
      const thisYear = dayInMonth(start.getFullYear(), sub.dueMonth - 1, sub.dueDayOfMonth);
      if (thisYear >= from) return thisYear;
      return dayInMonth(start.getFullYear() + 1, sub.dueMonth - 1, sub.dueDayOfMonth);
    }
  }
}

/** The occurrence after `day`, for the same schedule. */
function nextAfter(sub: ScheduledSubscription, day: string): string | null {
  const d = fromDayKey(day);

  switch (sub.frequency) {
    case 'daily':
      return toDayKey(addDays(d, 1));
    case 'weekly':
      return toDayKey(addDays(d, 7));
    case 'monthly': {
      if (!sub.dueDayOfMonth) return null;
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return dayInMonth(next.getFullYear(), next.getMonth(), sub.dueDayOfMonth);
    }
    case 'yearly': {
      if (!sub.dueDayOfMonth || !sub.dueMonth) return null;
      return dayInMonth(d.getFullYear() + 1, sub.dueMonth - 1, sub.dueDayOfMonth);
    }
  }
}

/**
 * Bound on how many occurrences one subscription may contribute.
 *
 * A daily subscription over a year is 365, so this only ever bites on a
 * malformed schedule that fails to advance — where it is the difference between
 * a wrong number and a frozen tab.
 */
const MAX_OCCURRENCES = 800;

/**
 * Every charge one subscription makes in `[from, to]`, inclusive.
 *
 * Charges are skipped when they fall before the subscription started billing,
 * and when they have already been posted — `lastChargedDay` is the server's
 * record of the most recent due date it has written an expense for, and
 * counting those again would double them against a period that already
 * contains them.
 */
export function chargesInWindow(
  sub: ScheduledSubscription,
  from: string,
  to: string
): ScheduledCharge[] {
  if (!isValidDayKey(from) || !isValidDayKey(to) || from > to) return [];

  // A subscription that doesn't post itself contributes nothing to a
  // projection: nobody is committed to paying it on any particular day, and
  // recording it is a decision the person makes each cycle.
  if (sub.autoRecord === false) return [];

  const floor = isValidDayKey(sub.startDay ?? '') ? (sub.startDay as string) : from;
  const start = floor > from ? floor : from;

  const charges: ScheduledCharge[] = [];
  let day = firstDueOnOrAfter(sub, start);

  for (let i = 0; day !== null && day <= to && i < MAX_OCCURRENCES; i++) {
    // Strictly after: `lastChargedDay` itself has already been posted, and its
    // expense is in the history the projection is measuring against.
    const alreadyPosted = isValidDayKey(sub.lastChargedDay ?? '') && day <= (sub.lastChargedDay as string);
    if (!alreadyPosted) {
      charges.push({
        day,
        amount: sub.amount,
        name: sub.name,
        subscriptionId: sub._id ?? null,
        category: sub.category ?? 'Subscriptions',
      });
    }
    const next = nextAfter(sub, day);
    // A schedule that fails to advance would loop forever; stopping is the only
    // safe answer, and it can only happen on a malformed record.
    if (next === null || next <= day) break;
    day = next;
  }

  return charges;
}

/** Every scheduled charge across a set of subscriptions, in date order. */
export function scheduledCharges(
  subscriptions: ScheduledSubscription[],
  from: string,
  to: string
): ScheduledCharge[] {
  return subscriptions
    .flatMap(sub => chargesInWindow(sub, from, to))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** What the scheduled charges in a window add up to. */
export const scheduledTotal = (
  subscriptions: ScheduledSubscription[],
  from: string,
  to: string
): number => scheduledCharges(subscriptions, from, to).reduce((total, c) => total + c.amount, 0);
