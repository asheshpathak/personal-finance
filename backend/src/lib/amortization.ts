import {
  addDaysKey,
  firstDueOnOrAfter,
  isDayKey,
  type Frequency,
  type Schedule,
} from './schedule';

/**
 * Loan arithmetic.
 *
 * The whole file rests on one decision: **a debt is not a stored balance, it is
 * an anchor plus a list of events replayed forward.** The anchor is
 * `openingBalance` on `balanceAsOf`; the events are the instalments the
 * schedule implies, any part-payments, and any interest-rate changes. The
 * schedule is derived, never persisted.
 *
 * That is what makes the user's actual requirement work. "If I part-pay in
 * future it should not mess up the previous" is only true if the past is not
 * stored as a running figure that a new event has to retroactively patch.
 * Replaying gives it for free: a prepayment dated next March changes every
 * instalment after next March and nothing before it, because nothing before it
 * is ever recomputed from the new event. A prepayment entered late, dated last
 * March, is equally safe — the replay simply starts producing different numbers
 * from that day, which is what actually happened.
 *
 * Three kinds of debt behave differently enough to need separate treatment:
 *
 *  · `amortizing`  — a term loan. Fixed instalment, interest on the reducing
 *                    balance, a definite payoff date.
 *  · `revolving`   — a credit card or overdraft. No term; what you pay is what
 *                    you choose, and the payoff date is a consequence of that
 *                    choice rather than an input.
 *  · `interest-free` — a family loan, a 0% BNPL plan. Balance divided by
 *                    instalment, and no interest anywhere.
 *
 * Money is handled in floating point and rounded only at the boundary. Minor
 * units would be more correct in a ledger; here every figure is a projection
 * tens of periods out, and the rounding error over that horizon is smaller than
 * the error in assuming the rate holds.
 */

export type DebtKind = 'amortizing' | 'revolving' | 'interest-free';

export type PrepaymentEffect = 'reduce-tenure' | 'reduce-emi';

export interface Prepayment {
  /** The day the money is (or was) paid, `YYYY-MM-DD`. */
  day: string;
  amount: number;
  /**
   * What the lender does with it. Reducing the tenure keeps the instalment and
   * ends the loan sooner, which saves far more interest; reducing the instalment
   * keeps the end date and frees monthly cash. Indian lenders default to
   * tenure reduction unless asked, and the difference over a home loan is
   * frequently seven figures — so it is a stored field, not an assumption.
   */
  effect: PrepaymentEffect;
  note?: string | undefined;
}

export interface RateChange {
  /** First day the new rate applies, `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** Nominal annual rate, as a percentage: 8.6 means 8.6% a year. */
  annualRate: number;
}

export interface DebtTerms extends Schedule {
  kind: DebtKind;
  frequency: Frequency;
  /** Nominal annual rate as a percentage. 0 for an interest-free debt. */
  annualRate: number;
  /** The scheduled instalment. For revolving debt, what they intend to pay. */
  instalment: number;
  /** Balance outstanding on `balanceAsOf` — the anchor the replay starts from. */
  openingBalance: number;
  balanceAsOf: string;
  prepayments?: Prepayment[] | undefined;
  rateChanges?: RateChange[] | undefined;
  /**
   * Revolving only: the lender's minimum, as a fraction of the balance
   * (0.05 = 5%), floored at `minimumFloor`. Used to warn when the intended
   * payment is below what the card will actually demand.
   */
  minimumFraction?: number | undefined;
  minimumFloor?: number | undefined;
}

/** One line of the derived schedule. */
export interface Instalment {
  /** Due day, `YYYY-MM-DD`. */
  day: string;
  /** 1-based position in the replay, for display. */
  number: number;
  /** Balance before this payment. */
  openingBalance: number;
  interest: number;
  principal: number;
  /** What actually moves: the instalment, or the final smaller settlement. */
  payment: number;
  /** Part-payments applied on this day, on top of the instalment. */
  prepaid: number;
  closingBalance: number;
  annualRate: number;
}

export interface Amortization {
  /** Every remaining instalment, oldest first. Capped — see `truncated`. */
  schedule: Instalment[];
  /** True when the projection hit its ceiling before the debt cleared. */
  truncated: boolean;
  /** The day the last payment falls, or null when it never clears. */
  payoffDay: string | null;
  /** Instalments remaining from the anchor. */
  periodsRemaining: number;
  /** Interest still to be paid from the anchor forward. */
  interestRemaining: number;
  /** Principal still to be paid from the anchor forward. */
  principalRemaining: number;
  /** Everything still to be paid: principal + interest + part-payments. */
  totalRemaining: number;
  /**
   * True when the instalment does not cover the interest, so the balance grows
   * every period. The single most important thing to be able to say about a
   * debt, and the reason this is a field rather than something a caller infers.
   */
  negativelyAmortizing: boolean;
}

/**
 * Instalments per year, by cadence.
 *
 * `daily` is here for completeness and is a genuinely bad idea for a loan; it
 * is supported so the schedule code has one shape rather than two.
 */
export const PERIODS_PER_YEAR: Record<Frequency, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  yearly: 1,
};

/** The periodic rate implied by a nominal annual rate at a given cadence. */
export const periodicRate = (annualRate: number, frequency: Frequency): number =>
  annualRate / 100 / PERIODS_PER_YEAR[frequency];

/**
 * How far a projection is allowed to run.
 *
 * 600 monthly periods is fifty years — past any real loan, and short enough
 * that a negatively-amortizing debt (which never clears) terminates rather than
 * spinning. Weekly and daily cadences are scaled so the wall is a duration
 * rather than a count.
 */
const maxPeriods = (frequency: Frequency): number =>
  frequency === 'daily' ? 3650 : frequency === 'weekly' ? 1560 : 600;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The instalment that clears `principal` over `periods` at `rate` per period.
 *
 * The zero-rate branch is not an optimisation — the closed form divides by
 * `rate`, so an interest-free loan would return NaN and quietly poison every
 * figure downstream.
 */
export function instalmentFor(principal: number, rate: number, periods: number): number {
  if (periods <= 0) return principal;
  if (rate <= 0) return principal / periods;
  const growth = Math.pow(1 + rate, periods);
  return (principal * rate * growth) / (growth - 1);
}

/**
 * How many instalments of `payment` clear `balance` at `rate` per period.
 *
 * Returns null when the payment never clears it — which is exactly the case
 * that matters, because "your minimum payment does not cover the interest" is
 * the most consequential sentence a credit-card holder can be shown.
 */
export function periodsToClear(balance: number, rate: number, payment: number): number | null {
  if (balance <= 0) return 0;
  if (payment <= 0) return null;
  if (rate <= 0) return Math.ceil(balance / payment);
  // The instalment has to beat the interest accruing on the current balance,
  // or the log below takes the logarithm of a non-positive number.
  if (payment <= balance * rate) return null;
  return Math.ceil(-Math.log(1 - (balance * rate) / payment) / Math.log(1 + rate));
}

/** The rate in force on a given day, honouring any scheduled rate changes. */
function rateOn(terms: DebtTerms, day: string): number {
  const changes = (terms.rateChanges ?? [])
    .filter(c => isDayKey(c.effectiveFrom) && Number.isFinite(c.annualRate))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));

  let annual = terms.annualRate;
  for (const change of changes) {
    if (change.effectiveFrom <= day) annual = change.annualRate;
    else break;
  }
  return annual;
}

/** The schedule fields, without the debt-specific ones around them. */
const scheduleOf = (terms: DebtTerms): Schedule => ({
  frequency: terms.frequency,
  dueDayOfWeek: terms.dueDayOfWeek,
  dueDayOfMonth: terms.dueDayOfMonth,
  dueMonth: terms.dueMonth,
});

/**
 * Replays a debt forward from its anchor.
 *
 * The loop is deliberately a simulation rather than a closed form. Closed forms
 * exist for a loan with one rate and no part-payments, and this app's users
 * have neither: a floating-rate home loan with three prepayments needs the
 * balance carried through every event in order, and a simulation is both the
 * shortest way to express that and the only one that stays right when a new
 * event is inserted anywhere in the timeline.
 */
export function amortize(terms: DebtTerms): Amortization {
  const anchor = isDayKey(terms.balanceAsOf) ? terms.balanceAsOf : null;
  const empty: Amortization = {
    schedule: [],
    truncated: false,
    payoffDay: null,
    periodsRemaining: 0,
    interestRemaining: 0,
    principalRemaining: 0,
    totalRemaining: 0,
    negativelyAmortizing: false,
  };

  if (!anchor || !(terms.openingBalance > 0)) return empty;

  const prepayments = (terms.prepayments ?? [])
    .filter(p => isDayKey(p.day) && Number.isFinite(p.amount) && p.amount > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const ceiling = maxPeriods(terms.frequency);
  const schedule: Instalment[] = [];

  let balance = terms.openingBalance;
  let instalment = terms.instalment > 0 ? terms.instalment : 0;
  let interestTotal = 0;
  let prepaidTotal = 0;
  let searchFrom = anchor;
  // Every part-payment strictly before the first instalment still has to land —
  // a lump sum paid the week the loan was anchored reduces what the first
  // instalment charges interest on. Applying them up front is what makes a
  // prepayment dated between two instalments behave correctly.
  let nextPrepayment = 0;

  const applyPrepaymentsBefore = (day: string): number => {
    let applied = 0;
    while (nextPrepayment < prepayments.length) {
      const p = prepayments[nextPrepayment];
      if (!p || p.day > day) break;
      const amount = Math.min(p.amount, balance);
      balance -= amount;
      applied += amount;
      prepaidTotal += amount;
      // Reducing the instalment keeps the end date; reducing the tenure keeps
      // the instalment. Only the first needs anything recomputed here — the
      // second falls out of the loop simply running fewer times.
      if (p.effect === 'reduce-emi' && terms.kind === 'amortizing' && balance > 0) {
        const remaining = periodsToClear(
          balance,
          periodicRate(rateOn(terms, p.day), terms.frequency),
          instalment
        );
        if (remaining && remaining > 0) {
          instalment = instalmentFor(
            balance,
            periodicRate(rateOn(terms, p.day), terms.frequency),
            remaining
          );
        }
      }
      nextPrepayment += 1;
    }
    return applied;
  };

  let negativelyAmortizing = false;

  for (let i = 0; i < ceiling && balance > 0.005; i++) {
    const due = firstDueOnOrAfter(scheduleOf(terms), searchFrom);
    // A schedule that cannot produce a date — weekly with no weekday set —
    // stops here rather than looping. Returning what was built keeps the caller
    // honest: the totals describe the part that could be projected.
    if (!due) break;

    const prepaid = applyPrepaymentsBefore(due);
    if (balance <= 0.005) {
      // A part-payment cleared it outright before this instalment fell due.
      schedule.push({
        day: prepayments[nextPrepayment - 1]?.day ?? due,
        number: schedule.length + 1,
        openingBalance: round2(balance + prepaid),
        interest: 0,
        principal: 0,
        payment: 0,
        prepaid: round2(prepaid),
        closingBalance: 0,
        annualRate: rateOn(terms, due),
      });
      break;
    }

    const annualRate = rateOn(terms, due);
    const rate = terms.kind === 'interest-free' ? 0 : periodicRate(annualRate, terms.frequency);
    const opening = balance;
    const interest = opening * rate;

    // Revolving debt has no contractual instalment, so "what they intend to
    // pay" is the instalment — and if that is below the lender's minimum the
    // caller is told, rather than the projection quietly using a number the
    // card would reject.
    let payment = instalment;
    if (payment <= 0) break;

    if (payment <= interest) {
      // The payment does not cover the interest. The balance grows every
      // period and the loan never ends; say so and stop rather than filling
      // fifty years of schedule with a number that only gets worse.
      negativelyAmortizing = true;
      schedule.push({
        day: due,
        number: schedule.length + 1,
        openingBalance: round2(opening),
        interest: round2(interest),
        principal: round2(payment - interest),
        payment: round2(payment),
        prepaid: round2(prepaid),
        closingBalance: round2(opening + interest - payment),
        annualRate,
      });
      interestTotal += interest;
      break;
    }

    // The last instalment is whatever is left, not a full payment — otherwise
    // the schedule ends on a negative balance and the totals overstate by up to
    // one instalment.
    if (payment > opening + interest) payment = opening + interest;

    const principal = payment - interest;
    balance = opening + interest - payment;
    interestTotal += interest;

    schedule.push({
      day: due,
      number: schedule.length + 1,
      openingBalance: round2(opening),
      interest: round2(interest),
      principal: round2(principal),
      payment: round2(payment),
      prepaid: round2(prepaid),
      closingBalance: round2(Math.max(0, balance)),
      annualRate,
    });

    searchFrom = addDaysKey(due, 1);
  }

  const truncated = balance > 0.005 && !negativelyAmortizing;
  const last = schedule[schedule.length - 1];

  const paymentsTotal = schedule.reduce((sum, row) => sum + row.payment, 0);

  return {
    schedule,
    truncated,
    payoffDay: balance <= 0.005 && last ? last.day : null,
    periodsRemaining: schedule.length,
    interestRemaining: round2(interestTotal),
    principalRemaining: round2(paymentsTotal - interestTotal + prepaidTotal),
    totalRemaining: round2(paymentsTotal + prepaidTotal),
    negativelyAmortizing,
  };
}

/**
 * The balance on a given day, derived rather than stored.
 *
 * Used everywhere a "what do I owe right now" figure is needed. Deriving it is
 * what keeps a late-entered part-payment from needing a migration: the number
 * simply changes the next time anyone asks.
 */
export function balanceOn(terms: DebtTerms, day: string): number {
  if (!isDayKey(day) || !isDayKey(terms.balanceAsOf)) return terms.openingBalance;
  if (day <= terms.balanceAsOf) return terms.openingBalance;

  const { schedule } = amortize(terms);
  let balance = terms.openingBalance;
  let lastApplied = terms.balanceAsOf;
  for (const row of schedule) {
    if (row.day > day) break;
    balance = row.closingBalance;
    lastApplied = row.day;
  }

  // A part payment made *between* two instalments reduces the balance the day
  // it is made, not at the next instalment. Walking only the schedule rows
  // misses it: someone who records ₹500,000 against their home loan and sees
  // the balance unchanged concludes the app did not take it, and they are not
  // wrong to — the money has left their account.
  //
  // Payments on the same day as an instalment are already inside that row, so
  // the boundary is strict.
  for (const prepayment of terms.prepayments ?? []) {
    if (!isDayKey(prepayment.day)) continue;
    if (prepayment.day > lastApplied && prepayment.day <= day) {
      balance = Math.max(0, balance - prepayment.amount);
    }
  }

  return round2(Math.max(0, balance));
}

export interface PrepaymentImpact {
  /** Interest paid over the rest of the loan without the extra payment. */
  interestWithout: number;
  interestWith: number;
  /** Positive means the prepayment saves this much interest. */
  interestSaved: number;
  payoffWithout: string | null;
  payoffWith: string | null;
  /** Instalments removed from the end of the loan. */
  periodsSaved: number;
  /** Instalment after the change — differs only for `reduce-emi`. */
  instalmentAfter: number;
  instalmentBefore: number;
}

/**
 * What one extra payment would do.
 *
 * Answering this is most of the reason to model debt at all. "Should I put the
 * bonus into the home loan" is unanswerable from a balance and a rate in your
 * head, and completely obvious once you can see that ₹200,000 today removes
 * ₹740,000 of interest and fourteen months.
 *
 * Both branches are run through the same replay, so the comparison cannot drift
 * from what the debt page shows.
 */
export function prepaymentImpact(
  terms: DebtTerms,
  extra: { day: string; amount: number; effect: PrepaymentEffect }
): PrepaymentImpact {
  const without = amortize(terms);
  const with_ = amortize({
    ...terms,
    prepayments: [...(terms.prepayments ?? []), extra],
  });

  const instalmentAfter =
    extra.effect === 'reduce-emi'
      ? (with_.schedule.find(row => row.day > extra.day)?.payment ?? terms.instalment)
      : terms.instalment;

  return {
    interestWithout: without.interestRemaining,
    interestWith: with_.interestRemaining,
    interestSaved: round2(without.interestRemaining - with_.interestRemaining),
    payoffWithout: without.payoffDay,
    payoffWith: with_.payoffDay,
    periodsSaved: without.periodsRemaining - with_.periodsRemaining,
    instalmentAfter: round2(instalmentAfter),
    instalmentBefore: round2(terms.instalment),
  };
}

/**
 * The lender's minimum payment on a revolving account.
 *
 * Indian and US cards both express it as a percentage of the statement balance
 * with an absolute floor. Returns 0 for anything that isn't revolving, so a
 * caller can compare unconditionally.
 */
export function minimumPayment(terms: DebtTerms, balance: number): number {
  if (terms.kind !== 'revolving') return 0;
  const fraction = terms.minimumFraction ?? 0.05;
  const floor = terms.minimumFloor ?? 0;
  return round2(Math.max(Math.min(balance, floor), balance * fraction));
}

/**
 * Monthly-equivalent cost of a debt, for adding across a portfolio.
 *
 * A weekly instalment and a yearly one cannot be summed as they stand, and the
 * comparison people actually want — "what do my debts cost me a month" — is the
 * annualised figure divided by twelve.
 */
export const monthlyEquivalent = (instalment: number, frequency: Frequency): number =>
  (instalment * PERIODS_PER_YEAR[frequency]) / 12;
