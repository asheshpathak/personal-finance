import {
  computeBudgetUtilization,
  expensesInPeriod,
  periodDays,
  SECTION_META,
  SUBSCRIPTION_CATEGORY,
  type Budget,
  type ExpenseLike,
  type SectionKey,
  type UtilizationSection,
} from './budgetSections';
import {
  buildCategoryStats,
  suggestAllocation,
  type IntelExpense,
  type Suggestion,
} from './budgetIntel';
import { addDays, daysBetween, endOfMonth, formatDayRange, fromDayKey, startOfDay, toDayKey } from './dates';

/**
 * The snapshot: what was planned, what actually happened, and what that means
 * for the next plan.
 *
 * The analytics page answers "where did the money go". This answers the
 * different and harder question — "did the money go where I *said* it would" —
 * and then turns the answer into next month's starting numbers. Everything is
 * derived here rather than in the view, so the headline, the bars and the
 * recommendations are guaranteed to be telling the same story.
 */

export interface SnapshotExpense extends ExpenseLike, IntelExpense {
  _id?: string;
  paymentMode?: string;
}

export type LineStatus = 'over' | 'on-track' | 'under' | 'unspent' | 'unplanned';

export interface LineVariance {
  category: string;
  section: SectionKey;
  planned: number;
  actual: number;
  /** actual − planned. Positive means overspent. */
  variance: number;
  /** Share of the plan used. Uncapped: 140% must not read as 100%. */
  usedPct: number;
  status: LineStatus;
  transactions: number;
}

export interface SectionVariance {
  key: SectionKey;
  label: string;
  color: string;
  planned: number;
  actual: number;
  variance: number;
  usedPct: number;
  lines: LineVariance[];
}

export interface Pacing {
  /** Days of the period that have passed, capped at its length. */
  elapsed: number;
  total: number;
  /** Fraction of the period gone. */
  elapsedPct: number;
  /** Fraction of the plan spent. */
  spentPct: number;
  /** True while the period is still running. */
  live: boolean;
  /** Spend per day so far. */
  burnRate: number;
  /** Where the period lands if the current rate holds. Null once it's over. */
  projected: number | null;
  daysLeft: number;
  /** What's left to spend per remaining day to finish on plan. Null if over. */
  safeDailySpend: number | null;
}

export type Verdict = 'under' | 'on-track' | 'tight' | 'over';

export interface SnapshotHeadline {
  planned: number;
  actual: number;
  variance: number;
  /** Everything paid in the period: planned lines plus unplanned spending. */
  periodTotal: number;
  income: number;
  /** income − actual. What the period actually left behind. */
  netSaved: number;
  verdict: Verdict;
  /** One sentence a reader can act on. */
  summary: string;
}

export interface Snapshot {
  budget: Budget;
  label: string;
  startDay: string;
  endDay: string;
  days: number;
  headline: SnapshotHeadline;
  sections: SectionVariance[];
  /** Every line, planned or not, ranked by how far off plan it landed. */
  lines: LineVariance[];
  /** Overspends, biggest gap first. */
  overspends: LineVariance[];
  /** Money planned but not spent, biggest first. */
  underspends: LineVariance[];
  /** Where the money actually went, ranked, with share of the total. */
  flow: { category: string; section: SectionKey; amount: number; share: number; transactions: number }[];
  unplanned: LineVariance[];
  unplannedTotal: number;
  pacing: Pacing;
}

/** Budget bounds are stored at UTC midnight, so their UTC day is the day picked. */
const boundDay = (value: string) => new Date(value).toISOString().slice(0, 10);

/**
 * "Jul 1 – Jul 31, 2026" — how a budget is named everywhere in the app.
 *
 * Goes through `boundDay` first. Handing the raw instant to
 * `toLocaleDateString` formats UTC midnight in the reader's zone, which is the
 * previous day for anyone west of Greenwich: a Jul 1–31 budget labelled itself
 * "Jun 30 – Jul 30" while every figure beneath it was still computed on Jul 1–31.
 */
export function budgetLabel(budget: { startDate: string; endDate: string }): string {
  return formatDayRange(fromDayKey(boundDay(budget.startDate)), fromDayKey(boundDay(budget.endDate)));
}

function classify(planned: number, actual: number): LineStatus {
  if (planned <= 0) return actual > 0 ? 'unplanned' : 'on-track';
  if (actual <= 0) return 'unspent';
  const used = actual / planned;
  if (used > 1.02) return 'over';
  // Anything under 85% of plan left real money on the table; between that and
  // just-over is close enough to call on-plan.
  if (used < 0.85) return 'under';
  return 'on-track';
}

function computePacing(startDay: string, endDay: string, planned: number, actual: number): Pacing {
  const start = fromDayKey(startDay);
  const end = fromDayKey(endDay);
  const today = startOfDay(new Date());
  const total = Math.max(1, daysBetween(start, end));

  const live = today >= start && today <= end;
  const elapsed = today < start ? 0 : Math.min(total, daysBetween(start, today > end ? end : today));

  const burnRate = elapsed > 0 ? actual / elapsed : 0;
  // Days *remaining including today*, matching `BudgetTotals.daysLeft` on the
  // dashboard. Counting today as spent instead made the two screens disagree by
  // one on every single day of the period.
  const daysLeft = Math.max(0, total - elapsed + (live ? 1 : 0));
  const remaining = planned - actual;

  return {
    elapsed,
    total,
    elapsedPct: (elapsed / total) * 100,
    spentPct: planned > 0 ? (actual / planned) * 100 : 0,
    live,
    burnRate,
    projected: live && elapsed > 0 ? burnRate * total : null,
    daysLeft,
    safeDailySpend: live && daysLeft > 0 && remaining > 0 ? remaining / daysLeft : null,
  };
}

function buildHeadline(
  planned: number,
  actual: number,
  periodTotal: number,
  income: number,
  pacing: Pacing,
  topOverspend: LineVariance | undefined,
  money: (value: number) => string
): SnapshotHeadline {
  const variance = actual - planned;
  const used = planned > 0 ? actual / planned : 0;

  let verdict: Verdict;
  if (planned <= 0) verdict = 'on-track';
  else if (used > 1.02) verdict = 'over';
  else if (used > 0.9) verdict = 'tight';
  else if (used < 0.75) verdict = 'under';
  else verdict = 'on-track';

  let summary: string;

  if (pacing.live) {
    // Mid-period, the useful comparison is against the calendar, not the total:
    // 60% of the budget spent is fine on day 20 of 30 and alarming on day 5.
    const ahead = pacing.spentPct - pacing.elapsedPct;
    if (planned <= 0) {
      summary = `${money(actual)} spent so far, with nothing planned to measure it against.`;
    } else if (ahead > 10) {
      summary = `${Math.round(pacing.spentPct)}% of the plan is spent with ${Math.round(pacing.elapsedPct)}% of the period gone — you're running ahead. ${
        pacing.safeDailySpend !== null
          ? `${money(pacing.safeDailySpend)} a day for the remaining ${pacing.daysLeft} keeps it on plan.`
          : 'The plan is already fully spent.'
      }`;
    } else if (ahead < -10) {
      summary = `Only ${Math.round(pacing.spentPct)}% of the plan spent ${Math.round(pacing.elapsedPct)}% of the way through — comfortably under pace.`;
    } else {
      summary = `Spending is tracking the calendar closely: ${Math.round(pacing.spentPct)}% of the plan at ${Math.round(pacing.elapsedPct)}% of the period.`;
    }
  } else if (verdict === 'over') {
    summary = `Finished ${money(Math.abs(variance))} over plan${
      topOverspend ? `, most of it ${topOverspend.category} at ${money(topOverspend.variance)} above its line` : ''
    }.`;
  } else if (verdict === 'under') {
    summary = `Finished ${money(Math.abs(variance))} under plan — ${Math.round(100 - used * 100)}% of the budget went unused.`;
  } else {
    summary = `Finished within ${money(Math.abs(variance))} of plan.`;
  }

  return {
    planned,
    actual,
    variance,
    periodTotal,
    income,
    netSaved: income - periodTotal,
    verdict,
    summary,
  };
}

/**
 * Turns one budget and the expense history into a complete snapshot.
 *
 * The planned-vs-actual matching is delegated to `computeBudgetUtilization`,
 * which already owns the tricky parts — proration of subscriptions, the
 * calendar-day period test, matching subscription payments by description. This
 * layer adds the variance reading on top, so the two can never disagree about
 * what "spent" means.
 */
export function buildSnapshot(
  budget: Budget,
  expenses: SnapshotExpense[],
  money: (value: number) => string
): Snapshot {
  const utilization = computeBudgetUtilization(budget, expenses);
  const inPeriod = expensesInPeriod(budget, expenses);

  /**
   * How many payments landed against one line.
   *
   * A subscription line is keyed by the subscription's *name*, while the
   * expenses it matches are filed under the category "Subscriptions" with the
   * name in the description — the same pairing `computeBudgetUtilization` uses
   * to attribute the money. Counting on category alone therefore reported
   * "0 payments · ₹649.00" for every subscription: a spend figure with nothing
   * behind it.
   */
  const normalize = (value: string | undefined) => (value ?? '').trim().toLowerCase();
  const transactionsFor = (name: string, section: SectionKey) =>
    section === 'subscriptions'
      ? inPeriod.filter(
          e => e.category === SUBSCRIPTION_CATEGORY && normalize(e.description) === normalize(name)
        ).length
      : inPeriod.filter(e => e.category === name).length;

  const sections: SectionVariance[] = utilization.sections.map((section: UtilizationSection) => ({
    key: section.key,
    label: section.label,
    color: section.color,
    planned: section.allocated,
    actual: section.spent,
    variance: section.spent - section.allocated,
    usedPct: section.rawPercentage,
    lines: section.items.map(item => ({
      category: item.category,
      section: section.key,
      planned: item.allocated,
      actual: item.spent,
      variance: item.spent - item.allocated,
      usedPct: item.rawPercentage,
      status: classify(item.allocated, item.spent),
      transactions: transactionsFor(item.category, section.key),
    })),
  }));

  const unplanned: LineVariance[] = utilization.unbudgeted.categories.map(c => ({
    category: c.category,
    section: 'expenses' as SectionKey,
    planned: 0,
    actual: c.amount,
    variance: c.amount,
    usedPct: 0,
    status: 'unplanned' as LineStatus,
    transactions: c.transactions,
  }));

  const lines = [...sections.flatMap(s => s.lines), ...unplanned];

  const planned = utilization.totals.allocated;
  const actual = utilization.totals.spent;
  const periodTotal = utilization.totals.periodTotal;

  const overspends = lines
    .filter(l => l.variance > 0 && (l.status === 'over' || l.status === 'unplanned'))
    .sort((a, b) => b.variance - a.variance);

  const underspends = lines
    .filter(l => l.planned > 0 && l.variance < 0)
    .sort((a, b) => a.variance - b.variance);

  // Where the money actually went — every line with spend, planned or not,
  // ranked. This is the "show me where it all went" view.
  const spentLines = lines.filter(l => l.actual > 0);
  const flowTotal = spentLines.reduce((sum, l) => sum + l.actual, 0);
  const flow = spentLines
    .map(l => ({
      category: l.category,
      section: l.section,
      amount: l.actual,
      share: flowTotal > 0 ? (l.actual / flowTotal) * 100 : 0,
      transactions: l.transactions,
    }))
    .sort((a, b) => b.amount - a.amount);

  const startDay = boundDay(budget.startDate);
  const endDay = boundDay(budget.endDate);
  const pacing = computePacing(startDay, endDay, planned, actual);

  return {
    budget,
    label: budgetLabel(budget),
    startDay,
    endDay,
    days: periodDays(budget.startDate, budget.endDate),
    headline: buildHeadline(planned, actual, periodTotal, budget.income ?? 0, pacing, overspends[0], money),
    sections,
    lines: [...lines].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
    overspends,
    underspends,
    flow,
    unplanned: [...unplanned].sort((a, b) => b.actual - a.actual),
    unplannedTotal: utilization.unbudgeted.total,
    pacing,
  };
}

// ── Carry-forward ───────────────────────────────────────────────────────────

export type PlanChange = 'raise' | 'lower' | 'keep' | 'add';

export interface PlanRecommendation {
  category: string;
  section: SectionKey;
  /** What this snapshot's budget planned. 0 for a category it never covered. */
  planned: number;
  actual: number;
  /** What to plan next time. */
  suggested: number;
  change: PlanChange;
  /** suggested − planned. */
  delta: number;
  reason: string;
  confidence: Suggestion['confidence'];
}

/**
 * What next period's plan should say, line by line.
 *
 * Two sources are blended, and which one leads depends on how much history
 * there is. A single period is one data point — anchoring next month to it
 * copies a bad month as faithfully as a good one — so where six months of
 * history exist the statistical baseline leads and this period informs it.
 * Where it doesn't, this period is all there is and it leads.
 *
 * Only meaningful moves are returned. A line already within 10% of what it
 * should be is left alone rather than dressed up as advice.
 */
export function buildRecommendations(
  snapshot: Snapshot,
  allExpenses: SnapshotExpense[],
  money: (value: number) => string,
  limit = 8
): PlanRecommendation[] {
  const stats = buildCategoryStats(allExpenses, 6, fromDayKey(snapshot.endDay));
  const recommendations: PlanRecommendation[] = [];

  const consider = (category: string, planned: number, actual: number, section: SectionKey) => {
    const stat = stats.get(category);
    const history = stat ? suggestAllocation(stat, snapshot.days) : null;

    // Investments and savings are *intentions*, not consumption. Spending
    // nothing on "Emergency Fund" means the goal was missed, not that the goal
    // was wrong — so a shortfall must never be turned into "plan less next
    // time". Cutting someone's savings target because they failed to hit it is
    // exactly the wrong advice, and it compounds. Only raises are offered here.
    const isGoal = section === 'investments' || section === 'savings';

    // Enough history to trust the statistical view? Otherwise this period is it.
    const suggested = history && history.monthsWithSpend >= 3
      ? history.amount
      : Math.round(Math.max(actual, 0) / 10) * 10;

    if (suggested <= 0 && planned <= 0) return;

    const delta = suggested - planned;
    if (isGoal && delta <= 0) return;

    const meaningful = planned <= 0
      ? suggested > 0
      : Math.abs(delta) / planned > 0.1 && Math.abs(delta) > 1;
    if (!meaningful) return;

    const change: PlanChange = planned <= 0 ? 'add' : delta > 0 ? 'raise' : 'lower';

    // Mid-period, "spent" is a running figure, not a verdict. Saying so keeps
    // the advice honest about a month that is only two-thirds done.
    const spentSoFar = snapshot.pacing.live ? `spent ${money(actual)} so far` : `spent ${money(actual)}`;

    let reason: string;
    if (planned <= 0) {
      reason = `Not in this plan, but you ${spentSoFar} on it. ${history?.rationale ?? ''}`.trim();
    } else if (delta > 0) {
      reason = isGoal
        ? `You're putting in ${money(actual)} against a ${money(planned)} target — history says you can carry ${money(suggested)}.`
        : `You planned ${money(planned)} and ${spentSoFar}. ${
            history && history.monthsWithSpend >= 3
              ? history.rationale
              : 'Raising it to what this period actually cost.'
          }`;
    } else {
      // The unspent money is planned − actual. Reporting |delta| here instead
      // quoted the size of the *recommended change*, which is a different and
      // much smaller number — "$550 never got used" for a line with $2,100
      // sitting untouched.
      const unused = Math.max(0, planned - actual);
      reason = `You planned ${money(planned)} and ${spentSoFar}${
        unused > 0 ? `, leaving ${money(unused)} unused` : ''
      }. ${history && history.monthsWithSpend >= 3 ? history.rationale : 'Freeing it up for somewhere it will be.'}`;
    }

    recommendations.push({
      category,
      section,
      planned,
      actual,
      suggested,
      change,
      delta,
      reason,
      confidence: history?.confidence ?? 'low',
    });
  };

  for (const line of snapshot.lines) {
    // Subscriptions are priced by the provider, not chosen — recommending a
    // different number for Netflix would be nonsense.
    if (line.section === 'subscriptions') continue;
    consider(line.category, line.planned, line.actual, line.section);
  }

  return recommendations
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

/**
 * The next period's dates, so "plan the next one" needs no date entry at all.
 *
 * A budget that covers a whole calendar month rolls to the *next whole calendar
 * month*, not to the same number of days. Carrying the day count forward is
 * subtly wrong for the common case: August is 31 days, so a naive copy would
 * produce "Sep 1 – Oct 1" — a period that spills a day into October and quietly
 * double-counts it against the month after. Anything that isn't a whole month
 * (a fortnight, a trip) does continue at the same length, which is what someone
 * planning in those units means.
 */
export function nextPeriod(snapshot: Snapshot): { start: string; end: string } {
  const start = fromDayKey(snapshot.startDay);
  const end = fromDayKey(snapshot.endDay);

  const coversWholeMonth =
    start.getDate() === 1 &&
    end.getFullYear() === start.getFullYear() &&
    end.getMonth() === start.getMonth() &&
    end.getDate() === endOfMonth(start).getDate();

  const today = startOfDay(new Date());

  if (coversWholeMonth) {
    // Roll forward until the proposed month is one you could still spend in.
    // Reading an old snapshot and tapping "plan the next one" would otherwise
    // open a budget for a month that finished long ago.
    let month = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    while (endOfMonth(month) < today) month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    return { start: toDayKey(month), end: toDayKey(endOfMonth(month)) };
  }

  let nextStart = addDays(end, 1);
  let nextEnd = addDays(nextStart, snapshot.days - 1);
  // Same rule for a custom-length period: step whole periods forward, never
  // land in the past. Bounded so a degenerate span can't spin.
  for (let i = 0; i < 240 && nextEnd < today; i++) {
    nextStart = addDays(nextEnd, 1);
    nextEnd = addDays(nextStart, snapshot.days - 1);
  }
  return { start: toDayKey(nextStart), end: toDayKey(nextEnd) };
}

export const SECTION_LABEL = (key: SectionKey) => SECTION_META[key].label;
export const SECTION_COLOR = (key: SectionKey) => SECTION_META[key].color;

export const STATUS_META: Record<LineStatus, { label: string; tone: 'over' | 'under' | 'neutral' }> = {
  over: { label: 'Over', tone: 'over' },
  'on-track': { label: 'On plan', tone: 'neutral' },
  under: { label: 'Under', tone: 'under' },
  unspent: { label: 'Unspent', tone: 'under' },
  unplanned: { label: 'Not planned', tone: 'over' },
};
