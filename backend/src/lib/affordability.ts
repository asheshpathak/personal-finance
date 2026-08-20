import { instalmentFor, periodsToClear } from './amortization';
import { AVG_MONTH_DAYS, type FinancialPosition } from './financialPosition';

/**
 * "Can I afford this?"
 *
 * The question people actually want answered, and the one a spending tracker
 * has never been able to answer because it only knows what left, not what is
 * there or what is owed. With income, debts and balances all recorded, it
 * becomes arithmetic — and the arithmetic is worth doing carefully, because the
 * naive version ("do you have the money in your account") gives a confident
 * yes to someone who would be clearing it off a 42% credit card for a year.
 *
 * Four things decide the answer, in this order:
 *
 *  1. **After paying, is the emergency buffer still intact?** Spending down to
 *     zero is not affording something, and this is the check that a bank
 *     balance alone never makes.
 *  2. **Does the monthly position still work?** A purchase with an ongoing cost
 *     — an EMI, a subscription, insurance, fuel — is a permanent change to the
 *     monthly picture, and a one-off balance check is blind to it.
 *  3. **Is there more expensive debt sitting there?** Paying cash for a want
 *     while carrying a 42% balance is a guaranteed 42% loss, and no answer that
 *     ignores it is honest.
 *  4. **How reliable is the income underneath it all?** The same purchase is a
 *     different decision on a salary and on freelance work.
 *
 * Every branch returns the figures it used. The point is not the verdict — it
 * is that someone can see why, disagree with a premise, and change it.
 */

export type Verdict = 'comfortable' | 'tight' | 'stretch' | 'no';

export interface AffordabilityRequest {
  /** What it is — "Japan trip", "iPhone". Only used in the explanation. */
  label: string;
  /**
   * Up-front cost, in the account currency.
   *
   * Zero is a real answer, not a missing one: hiring someone, a rent rise or a
   * new subscription costs nothing today and everything every month. When this
   * is zero and `recurringMonthly` is not, the verdict is decided entirely on
   * the monthly side.
   */
  amount: number;
  /** When they want it, `YYYY-MM-DD`. Defaults to today. */
  when?: string | undefined;
  /** How they would pay. `emi` prices the instalment from the terms below. */
  financing?: 'cash' | 'emi' | undefined;
  /** EMI plan length in months. */
  emiMonths?: number | undefined;
  /** EMI plan annual interest rate as a percentage. 0 for a no-cost plan. */
  emiRate?: number | undefined;
  /** Any recurring cost the purchase creates — insurance, a data plan, fuel. */
  recurringMonthly?: number | undefined;
  /**
   * Months of normal outgo to leave untouched. Three is the conventional
   * floor and the default; someone with variable income should use more.
   */
  bufferMonths?: number | undefined;
  /**
   * Set when this purchase is what a ring-fenced fund was saved for.
   *
   * A fund earmarked "house down payment" is off limits for a television and
   * exactly on limits for a house, and only the person asking knows which this
   * is. When true, any earmarked balance whose stated purpose matches `label`
   * is counted as available, and the answer names which ones.
   */
  useEarmarked?: boolean | undefined;
}

export interface AffordabilityAnswer {
  verdict: Verdict;
  /** One sentence, already written. The model may quote it verbatim. */
  headline: string;
  /** Every figure the verdict rests on, so it can be checked or disputed. */
  numbers: {
    cost: number;
    /** Liquid and not ring-fenced, today — plus any earmarked fund being used. */
    availableNow: number;
    /** Ring-fenced funds counted towards this purchase, and why. */
    earmarkedUsed: { name: string; balance: number; purpose: string }[];
    /** Earmarked funds that exist but were NOT counted — the model should say so. */
    earmarkedAvailableForThisPurpose: { name: string; balance: number; purpose: string }[];
    /** What the buffer rule reserves. */
    emergencyBuffer: number;
    /** Available minus the buffer: what could be spent without breaking it. */
    spendableNow: number;
    /** Available after paying cash. */
    availableAfter: number;
    /** Free cash flow in a normal month, before this purchase. */
    freeCashflowMonthly: number;
    /** And after, once any instalment and running cost are in. */
    freeCashflowAfter: number;
    /** Months of normal outgo the balances cover, after paying. */
    runwayAfterMonths: number | null;
    /** Instalment, when financed. */
    monthlyInstalment: number;
    /** Interest paid over an EMI plan. */
    financingCost: number;
    /** Debt servicing as a fraction of income, after the purchase. */
    debtToIncomeAfter: number | null;
    /** Months of saving at the current rate before it is affordable outright. */
    monthsToSave: number | null;
    /** The day that lands on, if it lands. */
    affordableFrom: string | null;
  };
  /** What is wrong or worth knowing, most consequential first. */
  cautions: string[];
  /** Concrete alternatives, when the answer is not a clean yes. */
  options: string[];
  /** Facts the answer is missing, so it can say so rather than guess. */
  missing: string[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A rate above this makes carrying a balance more expensive than most gains. */
const EXPENSIVE_RATE = 12;

const addMonths = (day: string, months: number): string => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, lastDay));
  return date.toISOString().slice(0, 10);
};

export function assessAffordability(
  position: FinancialPosition,
  request: AffordabilityRequest
): AffordabilityAnswer {
  const cost = Math.max(0, request.amount);
  const bufferMonths = request.bufferMonths ?? (hasVariableIncome(position) ? 6 : 3);
  const normalMonthlyOutgo = position.commitments.total + position.spending.variableMonthly;
  const emergencyBuffer = round2(normalMonthlyOutgo * bufferMonths);

  // ── Earmarked funds ───────────────────────────────────────────────────────
  //
  // Matched on shared meaningful words between what they are saving for and
  // what they are buying. Deliberately generous: the cost of a false positive
  // is one line saying "this counts your house fund", which the person can
  // disagree with; the cost of a false negative is telling someone saving for a
  // house that they cannot afford a house.
  const relevant = position.assets.earmarked.filter(fund =>
    purposeMatches(fund.purpose, request.label) || purposeMatches(fund.name, request.label)
  );
  const earmarkedUsed = request.useEarmarked !== false ? relevant : [];

  const availableNow = round2(
    position.assets.available + earmarkedUsed.reduce((sum, f) => sum + f.balance, 0)
  );
  const spendableNow = round2(Math.max(0, availableNow - emergencyBuffer));

  const cautions: string[] = [];
  const options: string[] = [];
  const missing: string[] = [];

  // ── What the answer is missing ────────────────────────────────────────────
  //
  // Named rather than papered over. An affordability verdict computed without a
  // balance is a guess, and presenting a guess in the same voice as an answer is
  // the failure this list exists to prevent.
  if (position.income.empty) missing.push('No income recorded — add it in Settings and this gets much sharper.');
  if (position.assets.total === 0) missing.push('No savings balances recorded, so there is nothing to pay from except future income.');
  if (position.spending.monthsObserved < 2) missing.push(`Only ${position.spending.monthsObserved} complete month(s) of spending history, so "a normal month" is a rough figure.`);
  if (position.assets.oldestAsOf && position.assets.oldestAsOf < addMonths(position.today, -3)) {
    missing.push(`Balances were last confirmed on ${position.assets.oldestAsOf} — worth updating before trusting this.`);
  }

  // ── Financing ─────────────────────────────────────────────────────────────
  const financing = request.financing ?? 'cash';
  let monthlyInstalment = 0;
  let financingCost = 0;

  if (financing === 'emi') {
    const months = Math.max(1, Math.round(request.emiMonths ?? 12));
    const rate = Math.max(0, request.emiRate ?? 0) / 100 / 12;
    monthlyInstalment = round2(instalmentFor(cost, rate, months));
    financingCost = round2(monthlyInstalment * months - cost);
  }

  const recurring = Math.max(0, request.recurringMonthly ?? 0);
  const monthlyAfter = round2(position.freeCashflowMonthly - monthlyInstalment - recurring);
  const conservativeAfter = round2(
    position.freeCashflowConservative - monthlyInstalment - recurring
  );

  const cashOutlay = financing === 'emi' ? 0 : cost;
  const availableAfter = round2(availableNow - cashOutlay);
  const outgoAfter = normalMonthlyOutgo + monthlyInstalment + recurring;
  const runwayAfterMonths = outgoAfter > 0 ? round2(availableAfter / outgoAfter) : null;

  const debtToIncomeAfter =
    position.income.monthly > 0
      ? round2((position.commitments.debt + monthlyInstalment) / position.income.monthly)
      : null;

  // ── Time to afford it outright ────────────────────────────────────────────
  const shortfall = Math.max(0, cost - spendableNow);
  const monthsToSave =
    shortfall === 0
      ? 0
      : position.freeCashflowMonthly > 0
        ? Math.ceil(shortfall / position.freeCashflowMonthly)
        : null;
  const affordableFrom =
    monthsToSave === null ? null : addMonths(position.today, monthsToSave);

  // ── Cautions ──────────────────────────────────────────────────────────────
  const expensive = position.debts.filter(
    d => d.status === 'active' && d.balance > 0 && d.annualRate >= EXPENSIVE_RATE
  );
  if (expensive.length > 0 && financing === 'cash' && cost > 0) {
    const worst = expensive[0]!;
    cautions.push(
      `You are carrying ${worst.name} at ${worst.annualRate}%, costing about ${Math.round(worst.monthlyInterestCost)} a month in interest. Money put there is a guaranteed ${worst.annualRate}% return; almost nothing else is.`
    );
  }

  const negative = position.debts.filter(d => d.negativelyAmortizing);
  if (negative.length > 0) {
    cautions.push(
      `${negative.map(d => d.name).join(', ')} is growing rather than shrinking — the payment does not cover the interest. That has to be fixed before anything discretionary.`
    );
  }

  if (position.freeCashflowMonthly < 0) {
    const gap = Math.abs(Math.round(position.freeCashflowMonthly));
    const discretionary = Math.round(position.spending.discretionaryMonthly);
    cautions.push(
      discretionary > gap
        ? `A normal month already runs about ${gap} short before this purchase — though discretionary spending is about ${discretionary} a month, so the gap is closeable.`
        : `A normal month already runs about ${gap} short before this purchase, and discretionary spending is only about ${discretionary} — the gap is larger than what there is to cut.`
    );
  }

  if (debtToIncomeAfter !== null && debtToIncomeAfter > 0.4) {
    cautions.push(
      `Debt payments would reach ${Math.round(debtToIncomeAfter * 100)}% of income — past the ~40% line most lenders treat as the ceiling.`
    );
  }

  if (hasVariableIncome(position) && monthlyAfter > 0 && conservativeAfter < 0) {
    cautions.push(
      'This works on an average month but not on a lean one, and some of your income is variable.'
    );
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  //
  // Ordered from the hardest constraint down. A no here is about the money not
  // being there in any form, not about disapproval.
  let verdict: Verdict;
  let headline: string;

  if (cost === 0 && recurring === 0) {
    verdict = 'comfortable';
    headline = 'Nothing to weigh up — the cost is zero.';
  } else if (cost === 0) {
    // A commitment with no purchase price: hiring someone, a rent rise, a new
    // subscription, school fees. The scenario suite caught this answering
    // "nothing to weigh up" to "can I afford to hire someone at ₹45,000 a
    // month" — a question that is entirely about the monthly side and has no
    // up-front cost to check at all. It is judged on headroom and on how long
    // the balances would absorb the difference.
    const monthsOfCover = recurring > 0 && monthlyAfter < 0
      ? Math.floor(availableNow / Math.abs(monthlyAfter))
      : null;

    if (monthlyAfter >= normalMonthlyOutgo * 0.05) {
      verdict = 'comfortable';
      headline = `Yes — ${Math.round(recurring)} a month against ${Math.round(position.freeCashflowMonthly)} of headroom, leaving about ${Math.round(monthlyAfter)} a month.`;
    } else if (monthlyAfter >= 0) {
      verdict = 'tight';
      headline = `It fits, with about ${Math.round(monthlyAfter)} a month to spare. There is no room for anything else on top.`;
    } else if (monthsOfCover !== null && monthsOfCover >= 12 && conservativeAfter < 0) {
      verdict = 'stretch';
      headline = `It runs you about ${Math.abs(Math.round(monthlyAfter))} a month short. Your balances would cover that for roughly ${monthsOfCover} months, so it is a bet on the gap closing, not a cost you can absorb.`;
    } else {
      verdict = 'no';
      headline = `Not at this income — it leaves you about ${Math.abs(Math.round(monthlyAfter))} short every month${monthsOfCover !== null ? `, and savings would absorb that for about ${monthsOfCover} months` : ''}.`;
    }
  } else if (financing === 'cash' && cost > availableNow) {
    verdict = 'no';
    headline =
      monthsToSave === null
        ? `Not from savings — that is ${round2(cost - availableNow)} more than you have, and a normal month leaves nothing over to close the gap.`
        : `Not yet. It is ${round2(cost - availableNow)} more than you have available; at your current rate that is about ${monthsToSave} month${monthsToSave === 1 ? '' : 's'} away.`;
  } else if (monthlyAfter < 0 && conservativeAfter < 0) {
    verdict = 'no';
    headline = `The monthly side does not work: it would leave you about ${Math.abs(Math.round(monthlyAfter))} short every month.`;
  } else if (financing === 'cash' && cost > spendableNow) {
    verdict = 'stretch';
    headline = `Possible, but it eats into your ${bufferMonths}-month emergency buffer — you would be left with about ${round2(runwayAfterMonths ?? 0)} months of cover.`;
  } else if (monthlyAfter < normalMonthlyOutgo * 0.05 || (runwayAfterMonths !== null && runwayAfterMonths < bufferMonths)) {
    verdict = 'tight';
    headline = `Affordable, but tight — about ${Math.round(monthlyAfter)} a month left over afterwards and ${round2(runwayAfterMonths ?? 0)} months of cover.`;
  } else {
    verdict = 'comfortable';
    headline =
      financing === 'emi'
        ? `Yes — ${Math.round(monthlyInstalment)} a month against ${Math.round(position.freeCashflowMonthly)} of monthly headroom, leaving about ${Math.round(monthlyAfter)}.`
        : `Yes — it leaves about ${Math.round(availableAfter)} available and your ${bufferMonths}-month buffer intact.`;
  }

  // ── Options ───────────────────────────────────────────────────────────────
  if (verdict !== 'comfortable' && cost === 0 && recurring > 0) {
    const discretionary = position.spending.discretionaryMonthly;
    if (discretionary > 0) {
      options.push(
        `Discretionary spending is about ${Math.round(discretionary)} a month. Redirecting ${Math.min(100, Math.round((Math.abs(Math.min(0, monthlyAfter)) / discretionary) * 100))}% of it would cover the gap.`
      );
    }
    if (position.income.streams.some(st => st.reliability !== 'guaranteed')) {
      options.push('Some of this income is not guaranteed, so judge this against a lean month rather than an average one.');
    }
    options.push(`Trial it for three months before committing — that costs ${Math.round(recurring * 3)} and tells you whether the figure holds.`);
  }

  if (verdict !== 'comfortable' && !(cost === 0 && recurring > 0)) {
    if (monthsToSave !== null && monthsToSave > 0) {
      options.push(`Wait about ${monthsToSave} month${monthsToSave === 1 ? '' : 's'} — ${affordableFrom} — and pay for it without touching the buffer.`);
    }
    if (financing === 'cash' && position.freeCashflowMonthly > 0) {
      const feasibleMonths = periodsToClear(cost, 0, position.freeCashflowMonthly * 0.5);
      if (feasibleMonths) {
        options.push(`Set aside ${Math.round(position.freeCashflowMonthly * 0.5)} a month and it is covered in ${feasibleMonths} months.`);
      }
    }
    // The option that only exists because spending is classified. "You are
    // short" is a dead end; "you are short, and you spend this much a month on
    // things you chose" is a decision someone can actually make.
    const discretionary = position.spending.discretionaryMonthly;
    if (discretionary > 0 && shortfall > 0) {
      const halved = discretionary / 2;
      const months = Math.ceil(shortfall / Math.max(1, position.freeCashflowMonthly + halved));
      if (Number.isFinite(months) && months > 0 && months <= 24) {
        options.push(
          `Discretionary spending — dining out, shopping, travel — runs about ${Math.round(discretionary)} a month. Halving it closes the gap in ${months} month${months === 1 ? '' : 's'} instead.`
        );
      }
    }
    if (expensive.length > 0) {
      const worst = expensive[0]!;
      options.push(`Clear ${worst.name} first — that frees ${Math.round(worst.monthlyCost)} a month once it is gone.`);
    }
    if (financing === 'cash' && monthlyAfter > 0) {
      options.push('A no-cost EMI would keep the savings intact, if the plan genuinely carries no interest — check for a processing fee.');
    }
  }

  if (earmarkedUsed.length > 0) {
    cautions.push(
      `This counts ${earmarkedUsed.map(f => `${f.name} (${Math.round(f.balance)}, set aside for ${f.purpose})`).join(' and ')}, because that is what the money was saved for. It is not counted for anything else.`
    );
  }

  if (financing === 'emi' && financingCost > 0) {
    cautions.push(`The plan adds ${Math.round(financingCost)} in interest — the real price is ${Math.round(cost + financingCost)}.`);
  }

  return {
    verdict,
    headline,
    numbers: {
      cost: round2(cost),
      availableNow,
      earmarkedUsed,
      earmarkedAvailableForThisPurpose: relevant,
      emergencyBuffer,
      spendableNow,
      availableAfter,
      freeCashflowMonthly: position.freeCashflowMonthly,
      freeCashflowAfter: monthlyAfter,
      runwayAfterMonths,
      monthlyInstalment,
      financingCost,
      debtToIncomeAfter,
      monthsToSave,
      affordableFrom,
    },
    cautions,
    options,
    missing,
  };
}

/**
 * Whether the income is genuinely lumpy.
 *
 * Only `variable` counts. The first version treated anything short of
 * "guaranteed" as variable, which meant a salary plus a rental marked "usually
 * arrives" doubled the emergency buffer from three months to six — and turned a
 * perfectly affordable purchase into "a stretch" on the strength of a hedge
 * word. The reliability scale has three points precisely so the middle one can
 * mean "slightly less certain" without meaning "plan for the worst".
 */
const hasVariableIncome = (position: FinancialPosition): boolean =>
  position.income.streams.some(s => s.reliability === 'variable');

/**
 * Whether a fund's stated purpose is the thing being bought.
 *
 * Word overlap on the words that carry meaning. "House fund" against "house
 * deposit" shares "house"; "Japan trip fund" against "new laptop" shares
 * nothing. Crude, and the alternative — asking the person to pick a fund from a
 * dropdown every time they ask a question — is worse.
 */
function purposeMatches(purpose: string, label: string): boolean {
  const noise = new Set([
    'fund', 'the', 'a', 'an', 'my', 'for', 'of', 'and', 'to', 'new', 'savings',
    'saving', 'account', 'money', 'buy', 'buying', 'down', 'payment',
  ]);
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !noise.has(w))
    );

  const a = words(purpose);
  const b = words(label);
  if (a.size === 0 || b.size === 0) return false;
  for (const word of a) if (b.has(word)) return true;
  return false;
}

/** Days-to-months, for a caller working in a budget window rather than months. */
export const monthsFromDays = (days: number): number => days / AVG_MONTH_DAYS;
