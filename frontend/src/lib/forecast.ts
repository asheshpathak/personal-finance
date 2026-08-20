import {
  clamp,
  hashSeed,
  mean,
  median,
  mulberry32,
  quantileSorted,
  shrink,
  sorted,
  trimmedMean,
} from './robust';
import { addDays, daysBetween, fromDayKey, isValidDayKey, toDayKey } from './dates';
import { scheduledCharges, type ScheduledCharge, type ScheduledSubscription } from './subscriptionSchedule';

/**
 * Where this period lands.
 *
 * ── The modelling decision everything else follows from ──────────────────────
 *
 * A period's total splits in two, and only one half needs a model:
 *
 *     total = money already spent
 *           + charges we know are coming   (deterministic — subscriptions)
 *           + variable spending            (stochastic — this is the forecast)
 *
 * This app has an unfair advantage over one built on a bank feed: subscriptions
 * carry an exact amount and an exact cadence, so the second term is arithmetic
 * rather than inference. Every model here therefore excludes auto-posted
 * charges from the *rate* it estimates — counting them once in the run-rate and
 * again in the add-back is the single easiest way to produce a forecast that is
 * confidently 30% too high.
 *
 * ── Why naive pacing is not good enough ──────────────────────────────────────
 *
 * The industry baseline is `spent × totalDays / elapsedDays`. It fails twice.
 * Rent landing on day one makes a day-two projection absurd, and its variance
 * scales as 1/elapsed, so the first week is noise presented as a number. Two
 * corrections fix both:
 *
 *  · **Exposure weighting.** Days are not interchangeable. A Saturday costs
 *    more than a Tuesday, so the denominator is weighted spending-days rather
 *    than calendar days.
 *
 *  · **Shrinkage.** The in-period signal is blended with the person's own
 *    history using a weight that grows with elapsed exposure. On day one the
 *    answer is essentially history; by day twenty it is essentially pacing.
 *    It is a two-line Gamma–Poisson posterior mean, and it removes the
 *    "on pace to spend ₹900,000 this month" embarrassment without a special
 *    case for early days.
 */

export interface ForecastExpense {
  amount: number;
  category: string;
  date: string;
  /** Auto-posted charges are excluded from every rate estimated here. */
  source?: 'manual' | 'subscription';
}

/** How much of the daily rate comes from history before any of this period is known. */
const PRIOR_STRENGTH_DAYS = 8;

/** Trailing window used to estimate the historical daily rate and day weights. */
const HISTORY_DAYS = 120;

/** Paths per simulation. Enough for stable deciles; runs in a few milliseconds. */
const SIM_PATHS = 2000;

// ── Daily series ────────────────────────────────────────────────────────────

/**
 * Daily totals across a window, zero-filled.
 *
 * The zero-filling is load-bearing rather than tidiness: a day with no spending
 * is real evidence about the rate, and dropping it turns "you spend on three
 * days in seven" into "you spend every day", roughly doubling every estimate.
 */
export function dailyTotals(
  expenses: ForecastExpense[],
  fromDay: string,
  toDay: string
): Map<string, number> {
  const totals = new Map<string, number>();
  if (!isValidDayKey(fromDay) || !isValidDayKey(toDay) || fromDay > toDay) return totals;

  for (let d = fromDayKey(fromDay), end = fromDayKey(toDay); d <= end; d = addDays(d, 1)) {
    totals.set(toDayKey(d), 0);
  }

  for (const e of expenses) {
    const day = toDayKey(new Date(e.date));
    if (!totals.has(day)) continue;
    totals.set(day, (totals.get(day) ?? 0) + e.amount);
  }

  return totals;
}

export type DayWeights = [number, number, number, number, number, number, number];

const FLAT_WEIGHTS: DayWeights = [1, 1, 1, 1, 1, 1, 1];

/**
 * How much a given weekday costs relative to an average day.
 *
 * Estimated as a ratio of medians rather than of means, so one Diwali Saturday
 * cannot decide what every Saturday is worth. Each weekday is then shrunk
 * toward 1 in proportion to how many of them were observed, which is what stops
 * three sampled Sundays from claiming Sundays cost double.
 *
 * Indexed by `Date.getDay()` — Sunday at 0.
 */
export function dayOfWeekWeights(totals: Map<string, number>): DayWeights {
  if (totals.size < 21) return FLAT_WEIGHTS; // under three weeks, every weekday is a guess

  const byDay: number[][] = [[], [], [], [], [], [], []];
  for (const [day, amount] of totals) {
    byDay[fromDayKey(day).getDay()]!.push(amount);
  }

  const overall = median([...totals.values()]);
  // Everything the median sees is zero — a very quiet window, or one where all
  // spending sits in a few large days. Either way there is no weekday signal.
  if (overall <= 0) return FLAT_WEIGHTS;

  const weights = byDay.map(values => {
    if (values.length === 0) return 1;
    const raw = median(values) / overall;
    // Bounded before shrinking: a weekday whose median is 8× the overall median
    // is telling you the overall median is near zero, not that the day is 8×.
    return shrink(clamp(raw, 0.2, 3), 1, values.length, 8);
  });

  // Renormalised to average 1, so the weights redistribute the rate rather than
  // scaling it — otherwise the projection would inherit their overall level.
  const avg = mean(weights);
  return (avg > 0 ? weights.map(w => w / avg) : weights) as DayWeights;
}

/** Total exposure weight across `[from, to]` inclusive. */
function exposure(from: string, to: string, weights: DayWeights): number {
  if (!isValidDayKey(from) || !isValidDayKey(to) || from > to) return 0;
  let total = 0;
  for (let d = fromDayKey(from), end = fromDayKey(to); d <= end; d = addDays(d, 1)) {
    total += weights[d.getDay()] ?? 1;
  }
  return total;
}

// ── The projection ──────────────────────────────────────────────────────────

export interface ProjectionInput {
  /** Every expense the person has recorded. Filtered internally. */
  expenses: ForecastExpense[];
  subscriptions: ScheduledSubscription[];
  /** Period bounds as `YYYY-MM-DD`. */
  startDay: string;
  endDay: string;
  /** The reader's today. Defaults to the local calendar day. */
  today?: string;
  /** Total planned for the period, when there is a plan. Drives risk of overrun. */
  planned?: number;
  /** Seed for the simulation, so the same period always yields the same band. */
  seed?: string;
}

export interface Projection {
  /** True while the period is still running. Past periods report actuals only. */
  live: boolean;
  startDay: string;
  endDay: string;
  today: string;
  totalDays: number;
  elapsedDays: number;
  /** Remaining days *including today*, matching the rest of the app's counting. */
  remainingDays: number;

  /** Everything recorded in the period so far, auto-posted charges included. */
  spentToDate: number;
  /** The part of that which nobody scheduled — the only part being modelled. */
  variableToDate: number;
  /** Scheduled charges from tomorrow to the end of the period. */
  committedRemaining: number;
  /** The individual charges behind that figure, for a bills-ahead list. */
  upcoming: ScheduledCharge[];

  /** Expected variable spend across the rest of the period. */
  variableRemaining: number;
  /** The headline: where the period lands if nothing changes. */
  expected: number;
  /** Empirical 10th and 90th percentiles from the simulation. */
  low: number;
  high: number;

  /** Modelled variable spend per weighted day. */
  dailyRate: number;
  /** Plain arithmetic burn: variable spend ÷ days elapsed. */
  burnRate: number;
  /** How far the daily rate leans on this period rather than on history, 0–1. */
  confidence: number;

  /** Share of simulated paths that finish above `planned`. Null with no plan. */
  riskOfOverrun: number | null;
  /** Variable spend per remaining weighted day that lands exactly on plan. */
  safeDailySpend: number | null;
  /** What today's allowance is, weighted for the weekday it happens to be. */
  safeToday: number | null;

  /** Enough history and enough of the period gone to be worth showing. */
  reliable: boolean;
}

const dayOf = (value: string) => toDayKey(new Date(value));

/**
 * Projects a budget period to its end.
 *
 * Deliberately pure and synchronous. A few hundred expenses is nothing, and
 * being able to recompute this on every keystroke is what lets a plan respond
 * as it is typed rather than after a round trip.
 */
export function projectPeriod({
  expenses,
  subscriptions,
  startDay,
  endDay,
  today = toDayKey(),
  planned,
  seed,
}: ProjectionInput): Projection {
  const start = fromDayKey(startDay);
  const end = fromDayKey(endDay);
  const now = fromDayKey(today);

  const totalDays = Math.max(1, daysBetween(start, end));
  const live = today >= startDay && today <= endDay;
  const past = today > endDay;

  const elapsedDays = past ? totalDays : live ? Math.max(1, daysBetween(start, now)) : 0;
  const remainingDays = Math.max(0, totalDays - elapsedDays + (live ? 1 : 0));

  // ── What has actually happened ────────────────────────────────────────────
  const inPeriod = expenses.filter(e => {
    const day = dayOf(e.date);
    return day >= startDay && day <= (live ? today : endDay);
  });

  const spentToDate = inPeriod.reduce((total, e) => total + e.amount, 0);
  const variableToDate = inPeriod
    .filter(e => e.source !== 'subscription')
    .reduce((total, e) => total + e.amount, 0);

  // ── What is already committed ─────────────────────────────────────────────
  //
  // From tomorrow, not from today: anything due today that was going to post
  // has posted, and the catch-up runs on every read. Counting today again would
  // double it against the expenses just summed.
  const upcoming = live
    ? scheduledCharges(subscriptions, toDayKey(addDays(now, 1)), endDay)
    : [];
  const committedRemaining = upcoming.reduce((total, c) => total + c.amount, 0);

  // ── The rate ──────────────────────────────────────────────────────────────
  //
  // History stops the day before this period began, so the period being
  // forecast never contributes to its own prior.
  const historyEnd = toDayKey(addDays(start, -1));
  const historyStart = toDayKey(addDays(fromDayKey(historyEnd), -(HISTORY_DAYS - 1)));
  const variableHistory = expenses.filter(e => e.source !== 'subscription');

  const historyDaily = dailyTotals(variableHistory, historyStart, historyEnd);
  const weights = dayOfWeekWeights(historyDaily);
  const historyValues = [...historyDaily.values()];

  // A trimmed mean, not a median. This figure has to *total* correctly across a
  // month, and the median daily spend is frequently zero — a plan built on it
  // would forecast nothing at all.
  const priorRate = trimmedMean(historyValues, 0.1);

  const elapsedExposure = live || past ? exposure(startDay, live ? today : endDay, weights) : 0;
  const remainingExposure = live ? exposure(toDayKey(addDays(now, 1)), endDay, weights) : 0;

  // The posterior mean of a Gamma–Poisson rate. `priorRate × strength` is the
  // pseudo-evidence history contributes; the period's own spending is weighed
  // against it by how much exposure has actually elapsed.
  const dailyRate =
    elapsedExposure + PRIOR_STRENGTH_DAYS > 0
      ? (priorRate * PRIOR_STRENGTH_DAYS + variableToDate) / (PRIOR_STRENGTH_DAYS + elapsedExposure)
      : priorRate;

  const variableRemaining = live ? dailyRate * remainingExposure : 0;
  const expected = spentToDate + committedRemaining + variableRemaining;

  // ── The band ──────────────────────────────────────────────────────────────
  const simulation = live
    ? simulateRemainder({
        historyDaily,
        priorRate,
        dailyRate,
        fromDay: toDayKey(addDays(now, 1)),
        toDay: endDay,
        floor: spentToDate + committedRemaining,
        planned,
        seed: seed ?? `${startDay}:${endDay}`,
      })
    : null;

  // The floor is not cosmetic. A statistical low estimate that sits below money
  // already spent is not a low estimate, it is a bug — and it is the single
  // most common complaint about forecast bands in this category.
  const floor = spentToDate + committedRemaining;
  const low = simulation ? Math.max(simulation.p10, floor) : expected;
  const high = simulation ? Math.max(simulation.p90, expected) : expected;

  // ── Allowances ────────────────────────────────────────────────────────────
  //
  // Committed charges leave the daily number entirely: they are subtracted from
  // what is left, never spread across days. That one choice removes the biggest
  // source of day-to-day whiplash, where a rent charge halves the allowance on
  // the day it posts and nothing the person did caused it.
  const headroom =
    planned !== undefined && planned > 0 ? planned - spentToDate - committedRemaining : null;

  const safeDailySpend =
    headroom !== null && live && remainingExposure > 0 && headroom > 0
      ? headroom / remainingExposure
      : headroom !== null && headroom <= 0
        ? 0
        : null;

  // Today's share, weighted for the weekday it is. A Saturday legitimately gets
  // more than a Tuesday, and pretending otherwise makes the number wrong in a
  // way people notice every weekend.
  const todayExposure = live ? exposure(today, today, weights) : 0;
  const remainingWithToday = live ? exposure(today, endDay, weights) : 0;
  const todayHeadroom =
    planned !== undefined && planned > 0 ? planned - (spentToDate - variableSpentToday(inPeriod, today)) - committedRemaining : null;

  const safeToday =
    todayHeadroom !== null && live && remainingWithToday > 0
      ? Math.max(0, (todayHeadroom * todayExposure) / remainingWithToday)
      : null;

  // Confidence is exposure-based rather than a fitted quantity: it is literally
  // how much of the rate came from this period rather than from history.
  const confidence =
    elapsedExposure + PRIOR_STRENGTH_DAYS > 0
      ? elapsedExposure / (elapsedExposure + PRIOR_STRENGTH_DAYS)
      : 0;

  return {
    live,
    startDay,
    endDay,
    today,
    totalDays,
    elapsedDays,
    remainingDays,
    spentToDate,
    variableToDate,
    committedRemaining,
    upcoming,
    variableRemaining,
    expected,
    low,
    high,
    dailyRate,
    burnRate: elapsedDays > 0 ? variableToDate / elapsedDays : 0,
    confidence,
    riskOfOverrun: simulation?.riskOfOverrun ?? null,
    safeDailySpend,
    safeToday,
    // Three weeks of history and a day of the period gone. Below that the
    // honest answer is "not yet", and showing a number anyway is how a forecast
    // loses its credibility permanently on the first look.
    reliable: historyValues.filter(v => v > 0).length >= 8 && (live ? elapsedDays >= 1 : true),
  };
}

/** Variable spend recorded today, so today's allowance nets off what's gone. */
function variableSpentToday(inPeriod: ForecastExpense[], today: string): number {
  return inPeriod
    .filter(e => e.source !== 'subscription' && dayOf(e.date) === today)
    .reduce((total, e) => total + e.amount, 0);
}

// ── Simulation ──────────────────────────────────────────────────────────────

interface SimulationInput {
  historyDaily: Map<string, number>;
  priorRate: number;
  dailyRate: number;
  fromDay: string;
  toDay: string;
  floor: number;
  planned: number | undefined;
  seed: string;
}

interface SimulationResult {
  p10: number;
  p50: number;
  p90: number;
  riskOfOverrun: number | null;
}

/**
 * Bootstraps the rest of the period from the person's own days.
 *
 * Daily spending is *zero-inflated* — most days are nothing, some are a lot —
 * so no smooth distribution describes it. Resampling whole observed days sidesteps
 * the problem entirely: the share of zero days, the size of the tail and the
 * weekday pattern all come along for free because they are properties of the
 * sample rather than assumptions of a model.
 *
 * The sampled days are then scaled so the simulation's centre matches the
 * shrunk posterior rate. Without that, the band would describe a typical past
 * month rather than *this* one, and would sit visibly wrong beside its own
 * headline figure whenever the current month is running hot or cold.
 */
function simulateRemainder({
  historyDaily,
  priorRate,
  dailyRate,
  fromDay,
  toDay,
  floor,
  planned,
  seed,
}: SimulationInput): SimulationResult | null {
  if (!isValidDayKey(fromDay) || !isValidDayKey(toDay) || fromDay > toDay) {
    return {
      p10: floor,
      p50: floor,
      p90: floor,
      riskOfOverrun: planned !== undefined && planned > 0 ? (floor > planned ? 1 : 0) : null,
    };
  }

  // Pools of observed day totals, per weekday, so a simulated Saturday is drawn
  // from real Saturdays.
  const pools: number[][] = [[], [], [], [], [], [], []];
  for (const [day, amount] of historyDaily) {
    pools[fromDayKey(day).getDay()]!.push(amount);
  }

  const all = [...historyDaily.values()];
  if (all.length < 14) return null;

  const scale = priorRate > 0 ? dailyRate / priorRate : 1;

  const days: number[] = [];
  for (let d = fromDayKey(fromDay), end = fromDayKey(toDay); d <= end; d = addDays(d, 1)) {
    days.push(d.getDay());
  }

  const rng = mulberry32(hashSeed(seed));
  const outcomes = new Float64Array(SIM_PATHS);

  for (let path = 0; path < SIM_PATHS; path++) {
    let total = 0;
    for (const dow of days) {
      // A weekday with too few observations of its own borrows the whole
      // sample rather than resampling three values into a fake certainty.
      const pool = pools[dow]!.length >= 6 ? pools[dow]! : all;
      total += pool[Math.floor(rng() * pool.length)] ?? 0;
    }
    outcomes[path] = floor + total * scale;
  }

  const asc = sorted(Array.from(outcomes));

  return {
    p10: quantileSorted(asc, 0.1),
    p50: quantileSorted(asc, 0.5),
    p90: quantileSorted(asc, 0.9),
    riskOfOverrun:
      planned !== undefined && planned > 0
        ? asc.filter(v => v > planned).length / asc.length
        : null,
  };
}

// ── Per-category outlook ────────────────────────────────────────────────────

export interface CategoryOutlook {
  category: string;
  planned: number;
  spent: number;
  /** Where this line lands at this rate. */
  projected: number;
  /** projected − planned. Positive means it is heading over. */
  variance: number;
  /** How the projection was reached, so the number can explain itself. */
  basis: 'paced' | 'history' | 'committed' | 'flat';
}

/**
 * Each planned line, projected to the end of the period.
 *
 * Which method applies depends on how much evidence the line has *this* period,
 * and the gate matters more than the maths. Pacing four transactions is
 * informative; pacing one is a coin-flip multiplied by thirty, and it is how
 * per-category forecasts get a reputation for being nonsense.
 */
export function categoryOutlook(
  projection: Projection,
  expenses: ForecastExpense[],
  plan: { category: string; planned: number }[],
  history: Map<string, number>
): CategoryOutlook[] {
  const { startDay, endDay, today, live, totalDays, elapsedDays } = projection;
  const pace = elapsedDays > 0 ? totalDays / elapsedDays : 1;

  const inPeriod = expenses.filter(e => {
    const day = dayOf(e.date);
    return day >= startDay && day <= (live ? today : endDay);
  });

  const spentBy = new Map<string, { amount: number; count: number }>();
  for (const e of inPeriod) {
    const entry = spentBy.get(e.category) ?? { amount: 0, count: 0 };
    entry.amount += e.amount;
    entry.count += 1;
    spentBy.set(e.category, entry);
  }

  const names = new Set([...plan.map(p => p.category), ...spentBy.keys()]);
  const plannedBy = new Map(plan.map(p => [p.category, p.planned]));

  return [...names]
    .map((category): CategoryOutlook => {
      const spent = spentBy.get(category)?.amount ?? 0;
      const count = spentBy.get(category)?.count ?? 0;
      const planned = plannedBy.get(category) ?? 0;
      // The typical monthly figure for this category, scaled to the period.
      const typical = (history.get(category) ?? 0) * (totalDays / 30.437);

      let projected: number;
      let basis: CategoryOutlook['basis'];

      if (!live) {
        projected = spent;
        basis = 'flat';
      } else if (count >= 4) {
        // Dense enough that this period's own rate means something.
        projected = spent * pace;
        basis = 'paced';
      } else if (count >= 1) {
        // Sparse. Pacing one transaction is noise; the floor at history keeps a
        // category that has already been paid once from projecting to nothing.
        projected = Math.max(spent, typical);
        basis = 'history';
      } else {
        projected = typical;
        basis = 'history';
      }

      return {
        category,
        planned,
        spent,
        projected,
        variance: projected - planned,
        basis,
      };
    })
    .filter(row => row.planned > 0 || row.spent > 0 || row.projected > 0)
    .sort((a, b) => b.variance - a.variance);
}

/**
 * Typical monthly spend per category, for the sparse branch above.
 *
 * A trimmed mean rather than a median for the reason stated at the top of this
 * file: these figures get summed, and a sum of medians under-counts.
 */
export function typicalMonthly(
  expenses: ForecastExpense[],
  months = 6,
  today: string = toDayKey()
): Map<string, number> {
  const now = fromDayKey(today);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const window: string[] = [];
  for (let i = months; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    window.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const inWindow = new Set(window);

  const byCategory = new Map<string, Map<string, number>>();
  for (const e of expenses) {
    const at = new Date(e.date);
    if (Number.isNaN(at.getTime()) || at >= currentMonthStart) continue;
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
    if (!inWindow.has(key)) continue;
    const perMonth = byCategory.get(e.category) ?? new Map<string, number>();
    perMonth.set(key, (perMonth.get(key) ?? 0) + e.amount);
    byCategory.set(e.category, perMonth);
  }

  const typical = new Map<string, number>();
  for (const [category, perMonth] of byCategory) {
    // Zero-filled across the window, so a category bought in one month of six
    // is priced at a sixth of that month rather than at the whole of it.
    typical.set(category, trimmedMean(window.map(m => perMonth.get(m) ?? 0), 0.1));
  }
  return typical;
}
