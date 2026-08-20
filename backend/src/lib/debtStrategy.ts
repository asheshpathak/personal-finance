import { amortize, type DebtTerms } from './amortization';

/**
 * Which debt to pay first, and what the choice is worth.
 *
 * Two orderings, and the whole argument between them:
 *
 * **Avalanche** targets the highest interest rate. It is arithmetically optimal
 * — always, by construction — and it is what to recommend by default.
 *
 * **Snowball** targets the smallest balance. It costs more in interest and it
 * finishes debts sooner, and the trial evidence is that people stick with it
 * more often. An app that only ever recommends the optimal order is giving
 * advice that is right about money and wrong about people, so both are computed
 * and the cost of choosing comfort is stated as a figure rather than argued
 * about.
 *
 * The comparison is honest only because both branches run through the same
 * replay as the debts page. A "you would save ₹340,000" that came from a
 * different model than the balances on screen is a number nobody can check.
 */

export type Strategy = 'avalanche' | 'snowball' | 'as-is';

export interface StrategyDebt extends DebtTerms {
  name: string;
  annualRate: number;
}

/**
 * True when the instalment does not cover one period's interest, so the balance
 * grows. Computed here rather than taken from the caller because the whole
 * recommendation hinges on it.
 */
const isGrowing = (debt: StrategyDebt): boolean => {
  if (debt.kind === 'interest-free' || debt.annualRate <= 0) return false;
  const rate = debt.annualRate / 100 / 12;
  return debt.instalment <= debt.openingBalance * rate;
};

export interface StrategyStep {
  name: string;
  /** Order of attack, 1-based. */
  position: number;
  clearedOn: string | null;
  interestPaid: number;
  annualRate: number;
  balance: number;
}

export interface StrategyResult {
  strategy: Strategy;
  /** Every debt clear, or null when one of them never does. */
  debtFreeOn: string | null;
  totalInterest: number;
  /** Total paid across every debt, interest included. */
  totalPaid: number;
  order: StrategyStep[];
  /** True when a debt in the plan never clears at the payments given. */
  neverClears: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const addMonths = (day: string, months: number): string => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  at.setUTCDate(Math.min(d, last));
  return at.toISOString().slice(0, 10);
};

/**
 * How many months and how much interest it takes to clear a set of debts, when
 * every spare rupee goes to one of them at a time.
 *
 * Modelled monthly rather than on each debt's own cadence. That is a
 * simplification and a deliberate one: the question is "which order, and is the
 * difference worth anything", and a weekly-versus-monthly timing detail moves
 * the answer by days on a horizon measured in years while roughly doubling the
 * code. The per-debt page keeps the exact schedule; this is the comparison.
 */
function simulate(
  debts: StrategyDebt[],
  extraMonthly: number,
  today: string,
  order: (a: StrategyDebt, b: StrategyDebt) => number,
  strategy: Strategy
): StrategyResult {
  // Working copies — the simulation mutates balances, and doing that to the
  // caller's rows would make a second call return different answers.
  const live = debts
    .filter(d => d.openingBalance > 0 && d.instalment > 0)
    .map(d => ({
      name: d.name,
      balance: d.openingBalance,
      rate: d.kind === 'interest-free' ? 0 : d.annualRate / 100 / 12,
      annualRate: d.annualRate,
      minimum: d.instalment,
      startBalance: d.openingBalance,
      interestPaid: 0,
      clearedOn: null as string | null,
    }));

  if (live.length === 0) {
    return { strategy, debtFreeOn: null, totalInterest: 0, totalPaid: 0, order: [], neverClears: false };
  }

  const queue = strategy === 'as-is' ? [...live] : [...live].sort((a, b) =>
    order(
      { ...debts.find(d => d.name === a.name)! },
      { ...debts.find(d => d.name === b.name)! }
    )
  );

  const positions = new Map(queue.map((d, i) => [d.name, i + 1]));

  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const MAX_MONTHS = 600;

  while (live.some(d => d.balance > 0.005) && month < MAX_MONTHS) {
    month += 1;
    const day = addMonths(today, month);

    // Everything freed by a cleared debt rolls forward. That rolling is the
    // entire mechanism — the reason either strategy beats paying minimums is
    // that the payment pool never shrinks.
    let pool = extraMonthly;
    for (const debt of live) {
      if (debt.balance <= 0.005) {
        pool += debt.minimum;
        continue;
      }
      const interest = debt.balance * debt.rate;
      debt.interestPaid += interest;
      totalInterest += interest;
      const payment = Math.min(debt.minimum, debt.balance + interest);
      debt.balance = debt.balance + interest - payment;
      totalPaid += payment;
      if (debt.balance <= 0.005) {
        debt.balance = 0;
        debt.clearedOn = day;
      }
    }

    // The pool goes to the front of the queue, then to the next, and so on —
    // paying more than a balance is wasted, so the remainder cascades.
    for (const target of queue) {
      if (pool <= 0.005) break;
      const debt = live.find(d => d.name === target.name);
      if (!debt || debt.balance <= 0.005) continue;
      const applied = Math.min(pool, debt.balance);
      debt.balance -= applied;
      pool -= applied;
      totalPaid += applied;
      if (debt.balance <= 0.005) {
        debt.balance = 0;
        debt.clearedOn = day;
      }
    }
  }

  const neverClears = live.some(d => d.balance > 0.005);
  const clearedDays = live.map(d => d.clearedOn).filter((d): d is string => Boolean(d));

  return {
    strategy,
    debtFreeOn: neverClears ? null : clearedDays.sort().slice(-1)[0] ?? null,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    neverClears,
    order: live
      .map(d => ({
        name: d.name,
        position: positions.get(d.name) ?? 0,
        clearedOn: d.clearedOn,
        interestPaid: round2(d.interestPaid),
        annualRate: d.annualRate,
        balance: round2(d.startBalance),
      }))
      .sort((a, b) => a.position - b.position),
  };
}

export interface StrategyComparison {
  /** Debts whose balance is growing at the current payment. Empty is the normal case. */
  growingDebts: { name: string; shortfallPerMonth: number; paymentNeededToStopGrowth: number }[];
  avalanche: StrategyResult;
  snowball: StrategyResult;
  /** Minimums only — the baseline both are measured against. */
  minimumsOnly: StrategyResult;
  /** What avalanche saves over snowball. Often small; say so when it is. */
  avalancheSavesOverSnowball: number;
  /** What the extra payment buys against paying minimums. */
  extraPaymentSaves: number;
  monthsSavedByExtra: number | null;
  recommendation: string;
}

export function compareStrategies(
  debts: StrategyDebt[],
  extraMonthly: number,
  today: string
): StrategyComparison {
  const avalanche = simulate(debts, extraMonthly, today, (a, b) => b.annualRate - a.annualRate, 'avalanche');
  const snowball = simulate(debts, extraMonthly, today, (a, b) => a.openingBalance - b.openingBalance, 'snowball');
  const minimumsOnly = simulate(debts, 0, today, (a, b) => b.annualRate - a.annualRate, 'as-is');

  const gap = round2(snowball.totalInterest - avalanche.totalInterest);
  const extraSaves = round2(minimumsOnly.totalInterest - avalanche.totalInterest);

  const monthsSaved =
    minimumsOnly.debtFreeOn && avalanche.debtFreeOn
      ? monthsBetween(avalanche.debtFreeOn, minimumsOnly.debtFreeOn)
      : null;

  const first = avalanche.order[0];

  // A debt that is growing outranks both orderings and every heuristic below.
  //
  // This is here because the scenario suite caught the alternative: a credit
  // card compounding at 42% against a personal loan at 18.5% produced almost
  // identical totals under either ordering, the "close enough, take the
  // snowball" branch fired, and the recommendation was to clear the small loan
  // first — while the card grew every month. The totals were not wrong; the
  // question they answer is the wrong question when one balance is running
  // away. Stopping the runaway is not an optimisation, it is the precondition
  // for either strategy meaning anything.
  const growing = debts.filter(isGrowing);

  // Written here rather than left to the model, so the same reasoning reaches
  // the chat and the screen. The threshold is a judgement: below a few percent
  // of the interest at stake, the orders are close enough that finishing a debt
  // early is worth more than the arithmetic.
  const closeEnough = avalanche.totalInterest > 0 && gap / avalanche.totalInterest < 0.03;

  const recommendation = !first
    ? 'No active debts to order.'
    : growing.length > 0
      ? `${growing.map(d => d.name).join(' and ')} first, and not because of the rate — the payment does not cover the interest, so the balance grows every month. Raising that payment above the monthly interest comes before any question of ordering; until it is, neither strategy ends.`
      : closeEnough
        ? `The two orders are within ${gap} of each other, which is noise on this size of debt. Take the snowball — clearing ${snowball.order[0]?.name} first is a visible win and the interest difference does not matter.`
        : `Pay ${first.name} first — it is the highest rate at ${first.annualRate}%. Doing it in that order rather than smallest-balance-first saves ${gap} in interest.`;

  return {
    growingDebts: growing.map(d => ({
      name: d.name,
      shortfallPerMonth: round2(d.openingBalance * (d.annualRate / 100 / 12) - d.instalment),
      paymentNeededToStopGrowth: round2(d.openingBalance * (d.annualRate / 100 / 12)),
    })),
    avalanche,
    snowball,
    minimumsOnly,
    avalancheSavesOverSnowball: gap,
    extraPaymentSaves: extraSaves,
    monthsSavedByExtra: monthsSaved,
    recommendation,
  };
}

function monthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 1] = from.split('-').map(Number);
  const [ty = 0, tm = 1] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Re-exported so a caller doesn't need the amortization module as well. */
export { amortize };
