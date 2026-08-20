import { INCOME_PER_YEAR, type IncomeFrequency } from '../models/IncomeSource';
import { isDayKey } from './schedule';

/**
 * Turning a set of income streams into the handful of figures the rest of the
 * app asks for.
 *
 * Two of them, really: "what do I earn in a month" and "what can I safely
 * assume I earn in a month". Keeping those separate is the point of this file.
 * A freelancer whose good months are ₹180,000 and whose bad months are ₹60,000
 * has a perfectly true average of ₹120,000, and every affordability answer
 * built on that average is wrong in the direction that costs them.
 */

export interface IncomeStream {
  name: string;
  type: string;
  amount: number;
  frequency: IncomeFrequency;
  reliability: 'guaranteed' | 'likely' | 'variable';
  typicalLow?: number | null | undefined;
  payDayOfMonth?: number | null | undefined;
  startDay?: string | null | undefined;
  endDay?: string | null | undefined;
  active?: boolean | undefined;
}

/** Whether a stream is live on a given day. */
export function isLiveOn(stream: IncomeStream, day: string): boolean {
  if (stream.active === false) return false;
  if (isDayKey(stream.startDay ?? '') && day < String(stream.startDay)) return false;
  if (isDayKey(stream.endDay ?? '') && day > String(stream.endDay)) return false;
  return true;
}

/** What one stream contributes to a month. One-off income contributes nothing. */
export const monthlyEquivalent = (stream: IncomeStream): number =>
  (stream.amount * INCOME_PER_YEAR[stream.frequency]) / 12;

/**
 * The conservative figure for a stream: what it is worth in a month you cannot
 * count on being a good one.
 *
 * `typicalLow` is a monthly floor the person supplied, so it is used directly
 * rather than scaled. Without one, variable income is discounted 30% and
 * "likely" income 10% — round numbers, deliberately, because the alternative is
 * a false precision nobody can check. The discount exists to stop a plan
 * assuming a best month twelve times a year, not to model anyone's variance.
 */
export function conservativeMonthly(stream: IncomeStream): number {
  const full = monthlyEquivalent(stream);
  if (stream.typicalLow != null && stream.typicalLow > 0) {
    return Math.min(full, stream.typicalLow);
  }
  if (stream.reliability === 'variable') return full * 0.7;
  if (stream.reliability === 'likely') return full * 0.9;
  return full;
}

export interface IncomeSummary {
  /** Sum of monthly equivalents across live, recurring streams. */
  monthly: number;
  /** The same, discounted for reliability. What planning should assume. */
  conservativeMonthly: number;
  /** Monthly figure from guaranteed streams alone. */
  guaranteedMonthly: number;
  annual: number;
  /** Live recurring streams, richest first. */
  streams: (IncomeStream & { monthly: number })[];
  /** Live one-off amounts, which are money but not a rate. */
  oneOffs: IncomeStream[];
  /** True when nothing has been recorded — a real state, not a zero. */
  empty: boolean;
}

export function summarizeIncome(streams: IncomeStream[], today: string): IncomeSummary {
  const live = streams.filter(s => isLiveOn(s, today));
  const recurring = live.filter(s => s.frequency !== 'one-off');
  const oneOffs = live.filter(s => s.frequency === 'one-off');

  const withMonthly = recurring
    .map(s => ({ ...s, monthly: monthlyEquivalent(s) }))
    .sort((a, b) => b.monthly - a.monthly);

  const monthly = withMonthly.reduce((sum, s) => sum + s.monthly, 0);

  return {
    monthly,
    conservativeMonthly: recurring.reduce((sum, s) => sum + conservativeMonthly(s), 0),
    guaranteedMonthly: recurring
      .filter(s => s.reliability === 'guaranteed')
      .reduce((sum, s) => sum + monthlyEquivalent(s), 0),
    annual: monthly * 12,
    streams: withMonthly,
    oneOffs,
    // Distinct from "monthly is 0": someone whose only stream is an unpaid
    // sabbatical has recorded their income, and the app should not keep asking.
    empty: streams.length === 0,
  };
}

/** Average days in a month, for scaling a monthly figure to any window. */
export const AVG_MONTH_DAYS = 30.437;

/**
 * Expected income across an arbitrary window.
 *
 * Prorated from the monthly figure rather than counted pay-date by pay-date.
 * Counting dates is more precise and less useful: a budget covering the 5th to
 * the 4th would show two salaries or none depending on where the boundary fell,
 * and the resulting "you can spend ₹0 this month" is a modelling artefact, not
 * a fact about anyone's money.
 */
export function incomeForPeriod(summary: IncomeSummary, days: number, conservative = false): number {
  const base = conservative ? summary.conservativeMonthly : summary.monthly;
  return (base / AVG_MONTH_DAYS) * days;
}
