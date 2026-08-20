import { addDays, fromDayKey, isValidDayKey, startOfWeek, toDayKey } from './dates';
import { median } from './robust';

/**
 * The habit layer.
 *
 * An expense tracker only works while it is being used, and the thing that
 * stops people using one is not a missing feature — it is that logging feels
 * like admin with no visible payoff. A streak fixes that cheaply, but only if
 * it is pointed at the right thing.
 *
 * **The streak counts logging days, never spending outcomes.** That distinction
 * is the whole design. A "days under budget" streak breaks on a car repair and
 * teaches the reader that the app is a scold; a "no-spend streak" makes a
 * necessary purchase feel like a failure. A logging streak measures the only
 * thing the person fully controls, and it is also the behaviour the app
 * actually needs from them.
 *
 * Everything else here is derived from the same one-bit-per-day series: how
 * many days had any payment at all.
 */

export interface RhythmExpense {
  amount: number;
  date: string;
  source?: 'manual' | 'subscription';
}

export interface DayCell {
  day: string;
  /** Total recorded on this day, auto-posted charges excluded. */
  amount: number;
  /** How many payments were entered. */
  count: number;
  /** Nothing spent — and the day is in the past, so it is a real zero. */
  noSpend: boolean;
  /** 0–4, for a heatmap. 0 means nothing spent. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Days after today, which are unknown rather than empty. */
  future: boolean;
}

export interface Rhythm {
  /** One cell per day across the requested window, oldest first. */
  cells: DayCell[];
  /** Consecutive days ending today (or yesterday) with something logged. */
  currentStreak: number;
  /** The longest run anywhere in the window. */
  longestStreak: number;
  /** Days with no spending at all in the window. */
  noSpendDays: number;
  /** No-spend days in the last 30, for a "this month" figure. */
  noSpendLast30: number;
  /** Days with something logged, over days in the window. */
  loggedRate: number;
  /** Typical spend on a day when anything was spent. */
  typicalDay: number;
  /** The heaviest single day in the window. */
  heaviest: DayCell | null;
  /** Totals by weekday, Monday first, for the rhythm strip. */
  byWeekday: { label: string; total: number; average: number; days: number }[];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The streak's grace period.
 *
 * A streak that resets the instant the clock passes midnight punishes someone
 * for not having logged *today* at 9am. Counting a streak as alive if yesterday
 * was logged gives the day to finish before it breaks — the same forgiveness
 * every streak that people actually keep is built with.
 */
function computeStreaks(cells: DayCell[], today: string): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const cell of cells) {
    if (cell.future) break;
    if (cell.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  // Walk back from today. If today has nothing yet, start from yesterday — the
  // day is not over.
  const byDay = new Map(cells.map(c => [c.day, c]));
  let cursor = today;
  if ((byDay.get(cursor)?.count ?? 0) === 0) {
    cursor = toDayKey(addDays(fromDayKey(today), -1));
  }

  let current = 0;
  while (byDay.has(cursor) && (byDay.get(cursor)?.count ?? 0) > 0) {
    current += 1;
    cursor = toDayKey(addDays(fromDayKey(cursor), -1));
  }

  return { current, longest };
}

export function buildRhythm(
  expenses: RhythmExpense[],
  { days = 182, today = toDayKey() }: { days?: number; today?: string } = {}
): Rhythm {
  const end = isValidDayKey(today) ? today : toDayKey();
  // Aligned to a week boundary so a heatmap renders as clean columns rather
  // than a ragged first week.
  const rawStart = addDays(fromDayKey(end), -(days - 1));
  const start = toDayKey(startOfWeek(rawStart));

  const totals = new Map<string, { amount: number; count: number }>();
  for (let d = fromDayKey(start), stop = fromDayKey(end); d <= stop; d = addDays(d, 1)) {
    totals.set(toDayKey(d), { amount: 0, count: 0 });
  }

  for (const e of expenses) {
    // Auto-posted charges are not evidence that anyone opened the app, and a
    // streak they keep alive by themselves measures nothing.
    if (e.source === 'subscription') continue;
    const day = toDayKey(new Date(e.date));
    const cell = totals.get(day);
    if (!cell) continue;
    cell.amount += e.amount;
    cell.count += 1;
  }

  const spentAmounts = [...totals.values()].filter(c => c.amount > 0).map(c => c.amount);
  const typicalDay = median(spentAmounts);
  // Four bands anchored on the typical day rather than the maximum: one
  // exceptional day would otherwise flatten every other cell to the lowest
  // shade and make the whole map read as empty.
  const level = (amount: number): DayCell['level'] => {
    if (amount <= 0) return 0;
    if (typicalDay <= 0) return 2;
    const ratio = amount / typicalDay;
    if (ratio < 0.5) return 1;
    if (ratio < 1.2) return 2;
    if (ratio < 2.5) return 3;
    return 4;
  };

  const cells: DayCell[] = [...totals.entries()].map(([day, { amount, count }]) => ({
    day,
    amount,
    count,
    noSpend: amount === 0 && day <= end,
    level: level(amount),
    future: day > end,
  }));

  const { current, longest } = computeStreaks(cells, end);

  const last30 = cells.slice(-30);
  const logged = cells.filter(c => !c.future && c.count > 0).length;
  const observed = cells.filter(c => !c.future).length;

  const byWeekday = WEEKDAY_LABELS.map((label, index) => {
    // Monday-first, matching how the rest of the app counts weeks.
    const matching = cells.filter(c => !c.future && (fromDayKey(c.day).getDay() + 6) % 7 === index);
    const total = matching.reduce((sum, c) => sum + c.amount, 0);
    return {
      label,
      total,
      average: matching.length > 0 ? total / matching.length : 0,
      days: matching.length,
    };
  });

  const heaviest = cells.reduce<DayCell | null>(
    (best, cell) => (!cell.future && (best === null || cell.amount > best.amount) ? cell : best),
    null
  );

  return {
    cells,
    currentStreak: current,
    longestStreak: longest,
    noSpendDays: cells.filter(c => c.noSpend).length,
    noSpendLast30: last30.filter(c => c.noSpend).length,
    loggedRate: observed > 0 ? logged / observed : 0,
    typicalDay,
    heaviest: heaviest && heaviest.amount > 0 ? heaviest : null,
    byWeekday,
  };
}

/**
 * Rounds every payment up to the next whole unit and totals the difference.
 *
 * A notional pot, never a transfer — this app cannot move money and must not
 * imply that it has. As a scoreboard it still works: round-ups succeed because
 * they run on habit rather than on motivation, and seeing what a year of loose
 * change adds up to is the entire point.
 */
export function roundUpPot(
  expenses: RhythmExpense[],
  { to = 10, since }: { to?: number; since?: string } = {}
): { total: number; payments: number } {
  let total = 0;
  let payments = 0;

  for (const e of expenses) {
    if (e.source === 'subscription') continue;
    if (since && toDayKey(new Date(e.date)) < since) continue;
    const remainder = e.amount % to;
    if (remainder === 0) continue;
    total += to - remainder;
    payments += 1;
  }

  return { total, payments };
}
