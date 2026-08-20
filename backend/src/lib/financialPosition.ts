import { amortize, balanceOn, minimumPayment, monthlyEquivalent as debtMonthly, type DebtTerms } from './amortization';
import { nextDueDay, type Frequency } from './schedule';
import { summarizeIncome, AVG_MONTH_DAYS, type IncomeStream, type IncomeSummary } from './income';
import { classifyCategory, type SpendClass } from './categoryClasses';

/**
 * One picture of a person's money.
 *
 * Everything that needs to reason about the whole financial position — the
 * dashboard, the budget planner, the affordability check, and every AI route —
 * reads it from here. That is a deliberate constraint rather than tidiness: the
 * moment two places compute "what's left over each month" independently, they
 * disagree, and the version the assistant quotes stops matching the version on
 * the screen. A user who catches that once stops believing either.
 *
 * The function is **pure**. It takes rows and returns figures, touching no
 * database and no clock. That is what lets the scenario harness build a whole
 * synthetic financial life in memory and get exactly the numbers the real app
 * would produce.
 */

export type Currency = 'USD' | 'INR';

export interface ExpenseRow {
  amount: number;
  category: string;
  /** ISO timestamp or `YYYY-MM-DD`. */
  date: string;
  description?: string | undefined;
  paymentMode?: string | undefined;
  source?: 'manual' | 'subscription' | 'debt' | undefined;
}

export interface SubscriptionRow {
  name: string;
  amount: number;
  frequency: Frequency;
  category: string;
  autoRecord?: boolean | undefined;
  dueDayOfMonth?: number | null | undefined;
  dueDayOfWeek?: string | null | undefined;
  dueMonth?: number | null | undefined;
  startDay?: string | null | undefined;
  lastChargedDay?: string | null | undefined;
}

export interface DebtRow extends DebtTerms {
  _id?: unknown;
  name: string;
  lender?: string | undefined;
  category: string;
  status?: 'active' | 'closed' | undefined;
  /** Originally borrowed. Context only — nothing is derived from it. */
  principal?: number | undefined;
  creditLimit?: number | null | undefined;
  startDay?: string | null | undefined;
  lastChargedDay?: string | null | undefined;
  termMonths?: number | null | undefined;
}

export interface AssetRow {
  name: string;
  kind: string;
  balance: number;
  asOf: string;
  liquid?: boolean | undefined;
  ringFenced?: boolean | undefined;
  /** What a ring-fenced balance is for. Empty means "nothing in particular". */
  earmarkedFor?: string | undefined;
}

export interface BudgetRow {
  _id?: unknown;
  startDate: string;
  endDate: string;
  isActive?: boolean | undefined;
  isDraft?: boolean | undefined;
  income?: number | undefined;
  categories?: { name: string; allocatedAmount: number }[] | undefined;
  investments?: { name: string; allocatedAmount: number }[] | undefined;
  savings?: { name: string; allocatedAmount: number }[] | undefined;
  subscriptions?: { name: string; amount: number; frequency: Frequency }[] | undefined;
  debts?: { name: string; amount: number }[] | undefined;
}

export interface PositionInput {
  today: string;
  currency?: Currency | undefined;
  expenses: ExpenseRow[];
  subscriptions: SubscriptionRow[];
  debts: DebtRow[];
  incomeSources: IncomeStream[];
  assets: AssetRow[];
  budgets: BudgetRow[];
}

export interface DebtView {
  name: string;
  lender: string;
  category: string;
  kind: string;
  /** Balance today, replayed from the anchor. */
  balance: number;
  annualRate: number;
  instalment: number;
  frequency: Frequency;
  /** The schedule, carried through so a planner can count occurrences. */
  dueDayOfMonth: number | null;
  dueDayOfWeek: string | null;
  dueMonth: number | null;
  monthlyCost: number;
  /**
   * Interest still to pay if nothing changes — or null when the answer is
   * "without limit".
   *
   * A debt whose payment does not cover its interest has no total: the balance
   * grows every month and so does the interest on it. Reporting the one month
   * the projection managed before it gave up would understate the position by
   * an unbounded amount, and it would understate it *quietly*, which is worse.
   */
  interestRemaining: number | null;
  payoffDay: string | null;
  periodsRemaining: number;
  nextDue: string | null;
  negativelyAmortizing: boolean;
  /** Revolving only; 0 otherwise. */
  minimumDue: number;
  /** Revolving only: balance ÷ limit, or null. */
  utilization: number | null;
  status: 'active' | 'closed';
  /**
   * Rate moves already applied, most recent last.
   *
   * Surfaced because the scenario suite asked "my home loan rate went up, what
   * does that mean for me" of an account that had recorded three rate changes,
   * and the assistant had to ask what the new rate was. Everything needed was
   * stored and none of it reached the context.
   */
  rateHistory: { effectiveFrom: string; annualRate: number }[];
  /**
   * Part payments already made, oldest first, and what they were worth.
   *
   * The scenario suite asked what the part payments had saved and was told
   * none had been made — of a loan carrying two. The events were stored, drove
   * the balance correctly, and appeared nowhere anyone could read them.
   *
   * `interestSaved` is the difference between the loan as it ran and the same
   * loan without that payment, so it is the real figure rather than the amount
   * paid.
   */
  prepaymentsMade: { day: string; amount: number; effect: string }[];
  /** Total interest removed by every part payment so far. */
  interestSavedByPrepayments: number;
  /** Part payments dated in the future — planned, not yet paid. */
  prepaymentsPlanned: { day: string; amount: number; effect: string }[];
  /**
   * Interest per month at today's balance. The figure that decides which debt
   * to attack first, and one nobody computes in their head.
   */
  monthlyInterestCost: number;
}

export interface CategorySpend {
  category: string;
  /** Whether this is a choice. See `categoryClasses.ts`. */
  spendClass: SpendClass;
  /** Median of the complete months in the window. */
  median: number;
  mean: number;
  /** Most recent complete month. */
  lastMonth: number;
  monthsWithSpend: number;
  total: number;
}

export interface FinancialPosition {
  today: string;
  currency: Currency;

  income: IncomeSummary;

  debts: DebtView[];
  debtTotals: {
    count: number;
    balance: number;
    /** Everything the debts cost in a month, added across cadences. */
    monthlyOutgo: number;
    interestRemaining: number;
    /**
     * Debts whose interest total is unbounded because the payment does not
     * cover it. Non-empty means `interestRemaining` is a floor, not a total.
     */
    interestUnbounded: string[];
    /** Interest accruing per month at today's balances. */
    monthlyInterestCost: number;
    /** The debt that clears last, if any ever does. */
    lastPayoffDay: string | null;
    /** Highest-rate debt first — the avalanche order. */
    highestRate: DebtView | null;
    /** Smallest balance first — the snowball order. */
    smallestBalance: DebtView | null;
  };

  subscriptions: {
    count: number;
    monthly: number;
    annual: number;
    /** The rows themselves, richest-per-month first. A plan needs the names. */
    list: (SubscriptionRow & { monthly: number })[];
  };

  assets: {
    total: number;
    liquid: number;
    /** Liquid and not ring-fenced: what could actually be spent. */
    available: number;
    netWorth: number;
    /** Oldest `asOf` across the balances — how stale the picture is. */
    oldestAsOf: string | null;
    /**
     * Ring-fenced balances that have a stated purpose, and are therefore
     * available for that purpose alone.
     */
    earmarked: { name: string; balance: number; purpose: string }[];
  };

  spending: {
    /** Median monthly spend that is neither an instalment nor a subscription. */
    variableMonthly: number;
    /**
     * Of that, the part that could stop next month without anything breaking.
     *
     * The single most actionable figure in the whole position: it is the
     * difference between "you are short" and "here is the money".
     */
    discretionaryMonthly: number;
    /** And the part that keeps the household running. */
    essentialMonthly: number;
    /** Money moved into savings or investments — spent from the account, still theirs. */
    setAsideMonthly: number;
    /** Median total monthly spend, everything included. */
    totalMonthly: number;
    /** Complete months of history the medians are built from. */
    monthsObserved: number;
    byCategory: CategorySpend[];
    /** Spend so far in the current, partial month. */
    thisMonthSoFar: number;
    /**
     * This month against a normal one, compared at the **same day of the month**.
     *
     * Computed here rather than left to the model, and the reason is that two
     * models given the same data produced two different answers to "how is this
     * month going": one prorated the monthly median across the days elapsed, the
     * other summed the previous months up to the same date. Both are defensible
     * and they disagree by tens of percent, which means whichever one the
     * dashboard happened to show was arbitrary.
     *
     * Same-day-of-month is the better of the two and it is not close. Prorating
     * assumes spending is uniform across a month, and nobody's is: rent lands on
     * the 1st, salary on the 1st, subscriptions in the first week. A prorated
     * comparison says every month is running hot until the 10th and cold
     * thereafter, on a person whose habits never changed.
     */
    pace: {
      /** Everything paid this month up to and including today. */
      soFar: number;
      /** What they had typically spent by this date, in previous months. */
      typicalByNow: number;
      /** And what a whole month usually comes to. */
      typicalFullMonth: number;
      /** soFar ÷ typicalByNow. Null when there is nothing to compare against. */
      ratio: number | null;
      status: 'ahead' | 'on-track' | 'behind' | 'too-early';
      dayOfMonth: number;
      /** How many previous months went into the comparison. */
      monthsCompared: number;
    };
  };

  commitments: {
    debt: number;
    subscriptions: number;
    /** Debt + subscriptions: what leaves on a schedule before any choice. */
    total: number;
  };

  /**
   * Income minus committed outgo minus a typical month of variable spending.
   * The single most useful number in the app: what is genuinely left over in a
   * normal month, as opposed to what is left after the fixed bills.
   */
  freeCashflowMonthly: number;
  /** The same, assuming income lands at its unreliable end. */
  freeCashflowConservative: number;

  /** Debt servicing as a fraction of income. Above 0.4 is where lenders balk. */
  debtToIncome: number | null;
  /** Free cash flow as a fraction of income. */
  savingsRate: number | null;
  /**
   * Months the available balances would cover with **no income at all**.
   * The right figure for "what if I stopped working".
   */
  runwayMonths: number | null;
  /**
   * Months until the balances are gone **at the current shortfall**, or null
   * when there is no shortfall.
   *
   * A different question from `runwayMonths` and the one people actually ask
   * when they are already losing money. Someone earning ₹28,000 against
   * ₹79,000 of outgo has a no-income runway of two years and is broke in
   * thirty-one months — the suite caught an answer that conflated the two and
   * gave both figures in the same paragraph.
   */
  monthsUntilBroke: number | null;

  activeBudget: BudgetRow | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * An expense's calendar day.
 *
 * Expenses are written at local noon precisely so this reads back as the day
 * that was picked wherever the server runs — noon is more than twelve hours
 * from either midnight, so no offset moves it.
 */
export function expenseDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const monthOf = (day: string) => day.slice(0, 7);

export function addMonthsToKey(monthKey: string, delta: number): string {
  const [y = 0, m = 1] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const FREQ_PER_YEAR: Record<Frequency, number> = { daily: 365, weekly: 52, monthly: 12, yearly: 1 };

/** How many complete months of history the spending medians look back over. */
const SPEND_WINDOW_MONTHS = 6;

export function buildPosition(input: PositionInput): FinancialPosition {
  const today = input.today;
  const currency: Currency = input.currency === 'INR' ? 'INR' : 'USD';

  // ── Income ────────────────────────────────────────────────────────────────
  const income = summarizeIncome(input.incomeSources, today);

  // ── Debts ─────────────────────────────────────────────────────────────────
  const debts: DebtView[] = input.debts.map(debt => {
    const active = (debt.status ?? 'active') === 'active';
    const balance = active ? balanceOn(debt, today) : 0;
    // Re-anchored at today's balance so the projection describes what is left,
    // not what was left when the debt was entered. Replaying from the original
    // anchor every time would be identical arithmetic and would re-charge
    // instalments that have already been paid into the totals.
    const forward: DebtTerms = { ...debt, openingBalance: balance, balanceAsOf: today };
    const projection = active
      ? amortize(forward)
      : { interestRemaining: 0, payoffDay: null, periodsRemaining: 0, negativelyAmortizing: false };

    const periodRate = debt.kind === 'interest-free' ? 0 : debt.annualRate / 100 / 12;

    const allPrepayments = debt.prepayments ?? [];
    const made = allPrepayments.filter(p => p.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1));
    const planned = allPrepayments.filter(p => p.day > today).sort((a, b) => (a.day < b.day ? -1 : 1));

    // What the part payments were worth: the loan as it actually ran, against
    // the same loan with those payments removed. Both replays start from the
    // original anchor, so the comparison is like for like.
    const interestSaved =
      made.length === 0 || !active
        ? 0
        : round2(
            Math.max(
              0,
              amortize({ ...debt, prepayments: planned }).interestRemaining
                - amortize(debt).interestRemaining
            )
          );

    return {
      name: debt.name,
      lender: debt.lender ?? '',
      category: debt.category,
      kind: debt.kind,
      balance: round2(balance),
      annualRate: debt.annualRate,
      instalment: debt.instalment,
      frequency: debt.frequency,
      dueDayOfMonth: debt.dueDayOfMonth ?? null,
      dueDayOfWeek: debt.dueDayOfWeek ?? null,
      dueMonth: debt.dueMonth ?? null,
      monthlyCost: active ? round2(debtMonthly(debt.instalment, debt.frequency)) : 0,
      interestRemaining: projection.negativelyAmortizing ? null : projection.interestRemaining,
      payoffDay: projection.payoffDay,
      periodsRemaining: projection.periodsRemaining,
      nextDue: active
        ? nextDueDay(
            {
              frequency: debt.frequency,
              dueDayOfWeek: debt.dueDayOfWeek,
              dueDayOfMonth: debt.dueDayOfMonth,
              dueMonth: debt.dueMonth,
              // Falls back to the balance date. The schedule walk resumes from
              // the last charge, or failing that the start day — and a row
              // written before `startDay` existed, or built in memory by the
              // scenario harness, has neither. Without the fallback the whole
              // resolver returns null and the debt renders as having no next
              // payment at all, which is the one thing it certainly has.
              startDay: debt.startDay ?? debt.balanceAsOf,
              lastChargedDay: debt.lastChargedDay,
            },
            today
          )
        : null,
      negativelyAmortizing: projection.negativelyAmortizing,
      minimumDue: active ? minimumPayment(debt, balance) : 0,
      utilization:
        debt.creditLimit && debt.creditLimit > 0 ? round2(balance / debt.creditLimit) : null,
      status: active ? 'active' : 'closed',
      prepaymentsMade: made.map(p => ({ day: p.day, amount: round2(p.amount), effect: p.effect })),
      prepaymentsPlanned: planned.map(p => ({ day: p.day, amount: round2(p.amount), effect: p.effect })),
      interestSavedByPrepayments: interestSaved,
      rateHistory: [...(debt.rateChanges ?? [])]
        .filter(c => c.effectiveFrom <= today)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
      monthlyInterestCost: round2(balance * periodRate),
    };
  });

  const activeDebts = debts.filter(d => d.status === 'active');

  const debtBalance = activeDebts.reduce((sum, d) => sum + d.balance, 0);
  const debtOutgo = activeDebts.reduce((sum, d) => sum + d.monthlyCost, 0);

  const payoffDays = activeDebts.map(d => d.payoffDay).filter((d): d is string => Boolean(d));

  const debtTotals = {
    count: activeDebts.length,
    balance: round2(debtBalance),
    monthlyOutgo: round2(debtOutgo),
    // Summed over the debts that will actually end. The unbounded ones are
    // counted separately, because adding a finite number to an infinite one and
    // printing the finite number is how a total lies.
    interestRemaining: round2(
      activeDebts.reduce((sum, d) => sum + (d.interestRemaining ?? 0), 0)
    ),
    interestUnbounded: activeDebts.filter(d => d.negativelyAmortizing).map(d => d.name),
    monthlyInterestCost: round2(activeDebts.reduce((sum, d) => sum + d.monthlyInterestCost, 0)),
    // Null when any active debt never clears — "your last debt ends in 2041" is
    // a lie if one of them is a card whose minimum never touches the principal.
    lastPayoffDay:
      activeDebts.length > 0 && payoffDays.length === activeDebts.length
        ? payoffDays.sort().slice(-1)[0] ?? null
        : null,
    highestRate:
      [...activeDebts].sort((a, b) => b.annualRate - a.annualRate)[0] ?? null,
    smallestBalance:
      [...activeDebts].filter(d => d.balance > 0).sort((a, b) => a.balance - b.balance)[0] ?? null,
  };

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const subMonthly = input.subscriptions.reduce(
    (sum, s) => sum + (s.amount * FREQ_PER_YEAR[s.frequency]) / 12,
    0
  );

  // ── Assets ────────────────────────────────────────────────────────────────
  const assetTotal = input.assets.reduce((sum, a) => sum + a.balance, 0);
  const liquidTotal = input.assets
    .filter(a => a.liquid !== false)
    .reduce((sum, a) => sum + a.balance, 0);
  const availableTotal = input.assets
    .filter(a => a.liquid !== false && a.ringFenced !== true)
    .reduce((sum, a) => sum + a.balance, 0);

  // ── Spending history ──────────────────────────────────────────────────────
  //
  // Complete months only. The current month is partial by definition, and a
  // median that includes it systematically under-states what a month costs —
  // which is precisely the direction that makes an affordability answer wrong.
  const currentMonth = monthOf(today);
  const window: string[] = [];
  for (let i = SPEND_WINDOW_MONTHS; i >= 1; i--) window.push(addMonthsToKey(currentMonth, -i));
  const windowStart = window[0] ?? currentMonth;

  const dayOfMonth = Number(today.slice(8, 10));
  // Spending in each prior month up to the same day-of-month as today, which is
  // what makes the pace comparison like-for-like.
  const byMonthToDate = new Map<string, number>(window.map(m => [m, 0]));

  const totalByMonth = new Map<string, number>(window.map(m => [m, 0]));
  const variableByMonth = new Map<string, number>(window.map(m => [m, 0]));
  const categoryByMonth = new Map<string, Map<string, number>>();
  let thisMonthSoFar = 0;
  let earliestMonth = currentMonth;

  for (const expense of input.expenses) {
    const day = expenseDay(expense.date);
    const month = monthOf(day);
    if (month < earliestMonth) earliestMonth = month;
    if (month === currentMonth && day <= today) thisMonthSoFar += expense.amount;
    if (month < windowStart || month >= currentMonth) continue;

    totalByMonth.set(month, (totalByMonth.get(month) ?? 0) + expense.amount);
    if (Number(day.slice(8, 10)) <= dayOfMonth) {
      byMonthToDate.set(month, (byMonthToDate.get(month) ?? 0) + expense.amount);
    }

    // Committed outgo is excluded from "variable" because it is already counted
    // separately, and counting an EMI in both places is how a plan ends up
    // subtracting the same ₹42,000 twice.
    if (expense.source !== 'debt' && expense.source !== 'subscription') {
      variableByMonth.set(month, (variableByMonth.get(month) ?? 0) + expense.amount);
    }

    const perMonth = categoryByMonth.get(expense.category) ?? new Map<string, number>();
    perMonth.set(month, (perMonth.get(month) ?? 0) + expense.amount);
    categoryByMonth.set(expense.category, perMonth);
  }

  // How many of the window's months the person was actually recording in. A
  // median over six months when only two have data reads as "you spend a third
  // of what you do", and every figure built on it inherits the error.
  const monthsObserved = window.filter(m => m >= earliestMonth).length;

  const observedWindow = window.filter(m => m >= earliestMonth);
  const byCategory: CategorySpend[] = [...categoryByMonth.entries()]
    .map(([category, perMonth]) => {
      const cells = observedWindow.map(m => perMonth.get(m) ?? 0);
      const total = cells.reduce((sum, v) => sum + v, 0);
      return {
        category,
        spendClass: classifyCategory(category),
        median: round2(median(cells)),
        mean: round2(cells.length > 0 ? total / cells.length : 0),
        lastMonth: round2(perMonth.get(observedWindow[observedWindow.length - 1] ?? '') ?? 0),
        monthsWithSpend: cells.filter(v => v > 0).length,
        total: round2(total),
      };
    })
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // ── Pace ──────────────────────────────────────────────────────────────────
  const toDateFigures = observedWindow.map(m => byMonthToDate.get(m) ?? 0).filter(v => v > 0);
  const typicalByNow = round2(median(toDateFigures));
  const paceRatio = typicalByNow > 0 ? round2(thisMonthSoFar / typicalByNow) : null;

  // Four days is the floor. Before that a single grocery run swings the ratio by
  // a factor of three, and "you are 210% over your usual pace" on the 2nd is
  // noise presented as a finding.
  const paceStatus: 'ahead' | 'on-track' | 'behind' | 'too-early' =
    dayOfMonth < 4 || toDateFigures.length < 2 || paceRatio === null
      ? 'too-early'
      : paceRatio < 0.85
        ? 'ahead'
        : paceRatio > 1.15
          ? 'behind'
          : 'on-track';

  const variableMonthly = round2(median(observedWindow.map(m => variableByMonth.get(m) ?? 0)));
  const totalMonthly = round2(median(observedWindow.map(m => totalByMonth.get(m) ?? 0)));

  // Summed from the per-category medians rather than re-medianed over months.
  // A median of sums and a sum of medians differ, and the sum is the one that
  // reconciles line by line with what is on screen — which matters more here
  // than the half-percent of statistical purity it costs.
  const byClass = (want: SpendClass) =>
    round2(
      byCategory
        .filter(c => c.spendClass === want && c.category !== 'Debt Payments' && c.category !== 'Subscriptions')
        .reduce((sum, c) => sum + c.median, 0)
    );

  const discretionaryMonthly = byClass('discretionary');
  const essentialMonthly = byClass('essential');
  const setAsideMonthly = byClass('setting-aside');

  // ── Derived position ──────────────────────────────────────────────────────
  const commitments = {
    debt: round2(debtOutgo),
    subscriptions: round2(subMonthly),
    total: round2(debtOutgo + subMonthly),
  };

  const freeCashflowMonthly = round2(income.monthly - commitments.total - variableMonthly);
  const freeCashflowConservative = round2(
    income.conservativeMonthly - commitments.total - variableMonthly
  );

  const normalMonthlyOutgo = commitments.total + variableMonthly;

  const activeBudget = input.budgets.find(b => b.isActive && !b.isDraft) ?? null;

  return {
    today,
    currency,
    income,
    debts,
    debtTotals,
    subscriptions: {
      count: input.subscriptions.length,
      monthly: round2(subMonthly),
      annual: round2(subMonthly * 12),
      list: input.subscriptions
        .map(s => ({ ...s, monthly: round2((s.amount * FREQ_PER_YEAR[s.frequency]) / 12) }))
        .sort((a, b) => b.monthly - a.monthly),
    },
    assets: {
      total: round2(assetTotal),
      liquid: round2(liquidTotal),
      available: round2(availableTotal),
      netWorth: round2(assetTotal - debtBalance),
      oldestAsOf:
        input.assets.length > 0
          ? [...input.assets].map(a => a.asOf).sort()[0] ?? null
          : null,
      earmarked: input.assets
        .filter(a => a.ringFenced && a.liquid !== false)
        .map(a => ({
          name: a.name,
          balance: round2(a.balance),
          // Falls back to the account's own name. "House fund" states its
          // purpose perfectly well without a second field being filled in, and
          // requiring one would leave the feature unused.
          purpose: (a.earmarkedFor ?? '').trim() || a.name,
        })),
    },
    spending: {
      variableMonthly,
      discretionaryMonthly,
      essentialMonthly,
      setAsideMonthly,
      totalMonthly,
      monthsObserved,
      byCategory,
      thisMonthSoFar: round2(thisMonthSoFar),
      pace: {
        soFar: round2(thisMonthSoFar),
        typicalByNow,
        typicalFullMonth: round2(median(observedWindow.map(m => totalByMonth.get(m) ?? 0))),
        ratio: paceRatio,
        status: paceStatus,
        dayOfMonth,
        monthsCompared: toDateFigures.length,
      },
    },
    commitments,
    freeCashflowMonthly,
    freeCashflowConservative,
    debtToIncome: income.monthly > 0 ? round2(debtOutgo / income.monthly) : null,
    savingsRate: income.monthly > 0 ? round2(freeCashflowMonthly / income.monthly) : null,
    runwayMonths: normalMonthlyOutgo > 0 ? round2(availableTotal / normalMonthlyOutgo) : null,
    monthsUntilBroke:
      freeCashflowMonthly < 0 ? round2(availableTotal / Math.abs(freeCashflowMonthly)) : null,
    activeBudget,
  };
}

export { AVG_MONTH_DAYS };
