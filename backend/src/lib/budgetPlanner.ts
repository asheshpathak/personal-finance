import { AVG_MONTH_DAYS, type FinancialPosition } from './financialPosition';
import { firstDueOnOrAfter, addDaysKey, isDayKey, type Frequency } from './schedule';

/**
 * Building a budget that survives contact with the month.
 *
 * The old planner asked someone to type a number per category and offered a
 * median from their history as a hint. That is a spreadsheet with suggestions.
 * What was missing is the part that makes a budget a *plan*: the money that is
 * already spoken for before any of it is allocated.
 *
 * So this works top-down instead. Income first; instalments and subscriptions
 * come off the top because they are not decisions; what remains is the amount
 * there is actually to plan with, and every category allocation is measured
 * against that rather than against a number someone hoped was right. A plan
 * that allocates ₹95,000 of a ₹70,000 remainder is caught here, in the maths,
 * rather than three weeks later.
 *
 * The category figures themselves are the same descriptive statistics the app
 * has always used — median month, adjusted for trend and volatility. That
 * choice is argued at length in the frontend's `budgetIntel`; the logic is
 * repeated here rather than shared because the two run in different processes,
 * and it is checked against that file when either changes.
 */

export interface PlanPeriod {
  startDate: string;
  endDate: string;
}

export interface PlannedLine {
  name: string;
  allocatedAmount: number;
  /** Where the number came from, in one sentence. */
  rationale: string;
  /** How much history stands behind it. */
  confidence: 'high' | 'medium' | 'low';
}

export interface DraftBudget {
  startDate: string;
  endDate: string;
  days: number;
  income: number;
  /** Income at the pessimistic end, for a sanity check. */
  incomeConservative: number;
  categories: PlannedLine[];
  investments: PlannedLine[];
  savings: PlannedLine[];
  subscriptions: { name: string; amount: number; frequency: Frequency }[];
  /** Instalments falling inside the period, as their own section. */
  debts: { name: string; amount: number; instalments: number }[];
  totals: {
    committed: number;
    discretionary: number;
    allocated: number;
    /** Income minus everything allocated. Negative means over-committed. */
    unallocated: number;
  };
  /** Anything the person should know before saving it. */
  warnings: string[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Rounds to an increment that reads as a decision rather than a computation. */
function tidy(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < 50) return Math.ceil(amount / 5) * 5;
  if (amount < 500) return Math.ceil(amount / 10) * 10;
  if (amount < 5000) return Math.ceil(amount / 50) * 50;
  return Math.ceil(amount / 100) * 100;
}

/** Inclusive length of the period in days; never less than one. */
export function periodDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 30;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/**
 * How many times a schedule falls inside a window.
 *
 * Counted rather than prorated, because a debt section that says "1.03
 * instalments" is not a plan anybody can act on — and in a period that happens
 * to contain two salary dates and one EMI, the difference between counting and
 * prorating is the difference between a budget that balances and one that does
 * not.
 */
function occurrencesIn(
  schedule: { frequency: Frequency; dueDayOfMonth?: number | null | undefined; dueDayOfWeek?: string | null | undefined; dueMonth?: number | null | undefined },
  from: string,
  to: string
): number {
  if (!isDayKey(from) || !isDayKey(to)) return 0;
  let count = 0;
  let cursor = from;
  // A month is at most 31 daily occurrences; the ceiling is a guard against a
  // schedule that can't advance, not a real limit.
  for (let i = 0; i < 400; i++) {
    const due = firstDueOnOrAfter(schedule, cursor);
    if (!due || due > to) break;
    count += 1;
    cursor = addDaysKey(due, 1);
  }
  return count;
}

/** Categories that are accounted for elsewhere and must not be planned twice. */
const HANDLED_ELSEWHERE = new Set(['Subscriptions', 'Debt Payments']);

const INVESTMENT_CATEGORIES = new Set([
  'Stocks', 'Mutual Funds', 'Gold', 'Crypto', 'Fixed Deposit', 'Bonds',
  'Real Estate', 'Retirement Fund', 'Trading', 'Other Investments',
]);

const SAVINGS_CATEGORIES = new Set([
  'Emergency Fund', 'General Savings', 'Vacation Fund', 'Home Down Payment',
  'Vehicle Fund', 'Education Fund', 'Other Savings',
]);

export interface PlannerOptions {
  /**
   * Fraction of what is left after commitments to steer into savings before
   * discretionary categories are filled. The default is 20% — the conventional
   * target, and a number worth stating rather than deriving so it can be argued
   * with.
   */
  savingsTarget?: number | undefined;
  /** Plan against the pessimistic income figure. Right for variable earners. */
  conservative?: boolean | undefined;
  /** Categories to leave out of the plan entirely. */
  exclude?: string[] | undefined;
}

/**
 * A complete first draft of a budget for a period.
 *
 * Everything is derived; nothing is asked for. The result is meant to be
 * argued with — by a person on the budget page, or by the assistant in a
 * drafting conversation — not accepted as given.
 */
export function draftBudget(
  position: FinancialPosition,
  period: PlanPeriod,
  options: PlannerOptions = {}
): DraftBudget {
  const days = periodDays(period.startDate, period.endDate);
  const scale = days / AVG_MONTH_DAYS;
  const exclude = new Set(options.exclude ?? []);
  const warnings: string[] = [];

  const income = round2(
    (options.conservative ? position.income.conservativeMonthly : position.income.monthly) * scale
  );
  const incomeConservative = round2(position.income.conservativeMonthly * scale);

  // ── Committed: instalments and subscriptions ──────────────────────────────
  const debts = position.debts
    .filter(d => d.status === 'active' && d.balance > 0)
    .map(d => {
      const instalments = occurrencesIn(d, period.startDate, period.endDate);
      // A schedule that produced nothing still costs money over the window —
      // falling back to the prorated monthly figure is better than a zero that
      // silently removes an EMI from the plan.
      const amount = instalments > 0 ? d.instalment * instalments : d.monthlyCost * scale;
      return { name: d.name, amount: round2(amount), instalments };
    })
    .filter(d => d.amount > 0);

  // Subscriptions are carried into the plan as their own section, snapshotted
  // at today's price so a past budget still reads correctly after one changes.
  const subscriptions = position.subscriptions.list.map(s => ({
    name: s.name,
    amount: s.amount,
    frequency: s.frequency,
  }));

  const debtTotal = debts.reduce((sum, d) => sum + d.amount, 0);
  const subscriptionTotal = round2(position.subscriptions.monthly * scale);
  const committed = round2(debtTotal + subscriptionTotal);

  const discretionary = round2(income - committed);

  if (income <= 0) {
    warnings.push('No income is recorded, so this plan has nothing to measure against. Add your income in Settings.');
  } else if (discretionary <= 0) {
    warnings.push(
      `Instalments and subscriptions alone come to ${Math.round(committed)} against income of ${Math.round(income)} — there is nothing left to allocate before a single expense.`
    );
  }

  // ── Discretionary categories, from history ────────────────────────────────
  const spendable = Math.max(0, discretionary);
  const savingsTarget = options.savingsTarget ?? 0.2;

  const historyLines: PlannedLine[] = [];
  const investmentLines: PlannedLine[] = [];
  const savingsLines: PlannedLine[] = [];

  for (const stat of position.spending.byCategory) {
    if (HANDLED_ELSEWHERE.has(stat.category) || exclude.has(stat.category)) continue;
    // One appearance months ago is history, not a pattern.
    if (stat.monthsWithSpend < 2 && stat.lastMonth === 0) continue;

    const occasional = stat.monthsWithSpend < Math.max(2, position.spending.monthsObserved / 2);
    // An occasional category is planned at what it costs *when it happens*;
    // averaging it across empty months under-funds every month it does happen.
    const base = occasional
      ? stat.total / Math.max(1, stat.monthsWithSpend)
      : Math.max(stat.median, stat.mean * 0.9);

    const line: PlannedLine = {
      name: stat.category,
      allocatedAmount: tidy(base * scale),
      rationale: occasional
        ? `Appears in ${stat.monthsWithSpend} of ${position.spending.monthsObserved} months — this is what it costs when it does.`
        : `Median month is ${Math.round(stat.median)}; last month was ${Math.round(stat.lastMonth)}.`,
      confidence:
        stat.monthsWithSpend >= 4 ? 'high' : stat.monthsWithSpend >= 2 ? 'medium' : 'low',
    };

    if (INVESTMENT_CATEGORIES.has(stat.category)) investmentLines.push(line);
    else if (SAVINGS_CATEGORIES.has(stat.category)) savingsLines.push(line);
    else historyLines.push(line);
  }

  historyLines.sort((a, b) => b.allocatedAmount - a.allocatedAmount);

  const spendingTotal = historyLines.reduce((sum, l) => sum + l.allocatedAmount, 0);
  const existingSet = investmentLines.reduce((s, l) => s + l.allocatedAmount, 0)
    + savingsLines.reduce((s, l) => s + l.allocatedAmount, 0);

  // ── The savings line ──────────────────────────────────────────────────────
  //
  // Filled from what is genuinely left rather than from the target, and named
  // as such. A plan that allocates 20% to savings and then overspends every
  // month has not saved 20% of anything; it has written a number down.
  const leftAfterSpending = round2(spendable - spendingTotal - existingSet);

  if (leftAfterSpending > 0) {
    const intended = Math.min(leftAfterSpending, spendable * savingsTarget);
    const emergencyGap = Math.max(
      0,
      (position.commitments.total + position.spending.variableMonthly) * 3 - position.assets.available
    );
    // An unbuilt emergency fund outranks every other destination for the money.
    // Nothing else in a plan is worth as much as not needing a credit card the
    // first time something breaks.
    const name = emergencyGap > 0 ? 'Emergency Fund' : 'General Savings';
    const existing = savingsLines.find(l => l.name === name);
    const amount = tidy(intended);
    if (amount > 0) {
      if (existing) {
        existing.allocatedAmount = Math.max(existing.allocatedAmount, amount);
        existing.rationale = emergencyGap > 0
          ? `Your buffer is about ${Math.round(emergencyGap)} short of three months of outgo — this closes it fastest.`
          : existing.rationale;
      } else {
        savingsLines.push({
          name,
          allocatedAmount: amount,
          rationale:
            emergencyGap > 0
              ? `Emergency cover is about ${Math.round(emergencyGap)} short of three months of outgo. This is the first call on what is left.`
              : `About ${Math.round(savingsTarget * 100)}% of what is left after commitments and normal spending.`,
          confidence: 'high',
        });
      }
    }
  }

  const allocated = round2(
    committed
      + historyLines.reduce((s, l) => s + l.allocatedAmount, 0)
      + investmentLines.reduce((s, l) => s + l.allocatedAmount, 0)
      + savingsLines.reduce((s, l) => s + l.allocatedAmount, 0)
  );

  const unallocated = round2(income - allocated);

  if (unallocated < 0) {
    warnings.push(
      `The plan allocates ${Math.round(Math.abs(unallocated))} more than comes in. Something here has to give — the largest discretionary lines are ${historyLines.slice(0, 2).map(l => l.name).join(' and ') || 'not yet set'}.`
    );
  }

  if (position.spending.monthsObserved < 3) {
    warnings.push(
      `Only ${position.spending.monthsObserved} complete month(s) of history, so the category figures are provisional.`
    );
  }

  const negativelyAmortizing = position.debts.filter(d => d.negativelyAmortizing);
  if (negativelyAmortizing.length > 0) {
    warnings.push(
      `${negativelyAmortizing.map(d => d.name).join(', ')} is growing rather than shrinking at the current payment. No budget fixes that — the payment has to rise.`
    );
  }

  return {
    startDate: period.startDate,
    endDate: period.endDate,
    days,
    income,
    incomeConservative,
    categories: historyLines,
    investments: investmentLines,
    savings: savingsLines,
    subscriptions,
    debts,
    totals: { committed, discretionary, allocated, unallocated },
    warnings,
  };
}
