import type { FinancialPosition } from './financialPosition';

/**
 * Where the balance goes over the next N months.
 *
 * The reason this is not "free cash flow × months" is that the monthly figure
 * is not constant, and the ways it changes are exactly the ones people forget:
 * a car loan finishing in March frees ₹18,000 a month from April, an annual
 * insurance premium lands once and wrecks one month, a bonus arrives in June.
 * A flat projection is wrong in both directions at once and is most wrong
 * precisely when someone is trying to decide whether they can afford something
 * later in the year.
 *
 * Monthly resolution, deliberately. Daily would imply a precision that a median
 * of six months of spending does not have.
 */

export interface CashflowMonth {
  /** `YYYY-MM`. */
  month: string;
  income: number;
  /** Instalments still running that month. */
  debtPayments: number;
  subscriptions: number;
  /** A typical month of everything else. */
  variableSpending: number;
  /** One-off money in, e.g. a bonus. */
  oneOffIncome: number;
  net: number;
  /** Running balance, starting from what is spendable today. */
  closingBalance: number;
  /** Anything notable that happens this month, in plain words. */
  events: string[];
}

export interface CashflowProjection {
  months: CashflowMonth[];
  startingBalance: number;
  /** The lowest the balance gets, and when. */
  lowestBalance: number;
  lowestMonth: string;
  /** First month the balance goes negative, if it does. */
  firstShortfallMonth: string | null;
  /** Balance at the end of the horizon. */
  endingBalance: number;
  /** Debts that clear inside the horizon, with the month they do. */
  debtsClearing: { name: string; month: string; frees: number }[];
  /** Stated because a projection built on thin history deserves a warning. */
  basis: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const addMonthKey = (monthKey: string, delta: number): string => {
  const [y = 0, m = 1] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

export interface ProjectionOptions {
  /** Assume income lands at its unreliable end. */
  conservative?: boolean | undefined;
  /** An extra monthly outgoing to test — a new EMI, a rent rise, a commitment. */
  extraMonthly?: number | undefined;
  /**
   * Months of no income, starting at `pauseFrom`.
   *
   * Added because the scenario suite asked "can I afford to take three months
   * off next year" and there was nothing to answer it with. It is the same
   * question as a sabbatical, a layoff, parental leave, or a business between
   * contracts — the four situations where knowing the answer matters most, and
   * the only ones a spending tracker has never been able to say anything about.
   */
  pauseIncomeMonths?: number | undefined;
  /** How many months from now the pause starts. Defaults to immediately. */
  pauseFrom?: number | undefined;
  /** A permanent change to monthly income, positive or negative — a raise, a cut. */
  incomeChangeMonthly?: number | undefined;
}

export function projectCashflow(
  position: FinancialPosition,
  months = 12,
  options: ProjectionOptions = {}
): CashflowProjection {
  const horizon = Math.max(1, Math.min(months, 60));
  const startMonth = position.today.slice(0, 7);

  const baseIncome =
    (options.conservative ? position.income.conservativeMonthly : position.income.monthly)
    + (options.incomeChangeMonthly ?? 0);

  const pauseMonths = Math.max(0, Math.round(options.pauseIncomeMonths ?? 0));
  const pauseFrom = Math.max(0, Math.round(options.pauseFrom ?? 0));

  const variable = position.spending.variableMonthly;
  const subscriptions = position.subscriptions.monthly;

  // Each debt contributes until the month it clears, then stops. That single
  // rule is most of the value here.
  const debtEnds = position.debts
    .filter(d => d.status === 'active' && d.balance > 0)
    .map(d => ({
      name: d.name,
      monthly: d.monthlyCost,
      // A debt that never clears runs for the whole horizon, which is exactly
      // what it does in reality.
      endsAfter: d.payoffDay ? monthsBetween(startMonth, d.payoffDay.slice(0, 7)) : Infinity,
    }));

  const rows: CashflowMonth[] = [];
  const debtsClearing: { name: string; month: string; frees: number }[] = [];

  let balance = position.assets.available;
  let lowestBalance = balance;
  let lowestMonth = startMonth;
  let firstShortfallMonth: string | null = null;

  for (let i = 0; i < horizon; i++) {
    const month = addMonthKey(startMonth, i);
    const events: string[] = [];

    const debtPayments = debtEnds
      .filter(d => i <= d.endsAfter)
      .reduce((sum, d) => sum + d.monthly, 0);

    for (const debt of debtEnds) {
      if (debt.endsAfter === i) {
        events.push(`${debt.name} is paid off — frees ${Math.round(debt.monthly)} a month from here`);
        debtsClearing.push({ name: debt.name, month, frees: round2(debt.monthly) });
      }
    }

    // One-off income is placed in the first month rather than spread. It is
    // money that arrives once, and smearing it across a year is how a bonus
    // ends up funding a permanent lifestyle in a projection.
    const oneOff = i === 0
      ? position.income.oneOffs.reduce((sum, o) => sum + o.amount, 0)
      : 0;
    if (oneOff > 0) events.push(`One-off income of ${Math.round(oneOff)}`);

    // Instalments and subscriptions do not pause when income does. That is the
    // whole point of asking: what leaves the account is unchanged, and only
    // what arrives stops.
    const paused = pauseMonths > 0 && i >= pauseFrom && i < pauseFrom + pauseMonths;
    if (paused && i === pauseFrom) {
      events.push(`Income stops here for ${pauseMonths} month${pauseMonths === 1 ? '' : 's'}`);
    }
    if (pauseMonths > 0 && i === pauseFrom + pauseMonths) {
      events.push('Income resumes');
    }

    const monthIncome = paused ? 0 : baseIncome;

    const net = round2(
      monthIncome + oneOff - debtPayments - subscriptions - variable - (options.extraMonthly ?? 0)
    );
    balance = round2(balance + net);

    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestMonth = month;
    }
    if (balance < 0 && firstShortfallMonth === null) firstShortfallMonth = month;

    rows.push({
      month,
      income: round2(monthIncome),
      debtPayments: round2(debtPayments),
      subscriptions: round2(subscriptions),
      variableSpending: round2(variable),
      oneOffIncome: round2(oneOff),
      net,
      closingBalance: balance,
      events,
    });
  }

  return {
    months: rows,
    startingBalance: round2(position.assets.available),
    lowestBalance,
    lowestMonth,
    firstShortfallMonth,
    endingBalance: balance,
    debtsClearing,
    basis:
      `Income ${Math.round(baseIncome)}/mo${options.conservative ? ' (lean-month figure)' : ''}`
      + (pauseMonths > 0 ? `, paused for ${pauseMonths} months from month ${pauseFrom + 1}` : '')
      + `, ` +
      `variable spending ${Math.round(variable)}/mo from the median of ${position.spending.monthsObserved} complete months` +
      (position.spending.monthsObserved < 3 ? ' — thin history, treat as provisional' : '') +
      '. Assumes habits hold and no unplanned expense.',
  };
}

function monthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 1] = from.split('-').map(Number);
  const [ty = 0, tm = 1] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
