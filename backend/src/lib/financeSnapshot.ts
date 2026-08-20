import { loadFinanceData } from './loadPosition';
import {
  buildPosition,
  expenseDay,
  addMonthsToKey,
  type FinancialPosition,
  type PositionInput,
} from './financialPosition';

/**
 * The user's money, compressed into something a model can read.
 *
 * Three design rules drive everything here.
 *
 * **It has to be stable.** This block is the cached prefix of every AI request,
 * and prompt caching is a *prefix match* — one byte of drift and the whole
 * cache is thrown away. So nothing in here is derived from the wall clock at
 * finer than day resolution, every map is emitted in a sorted order, and every
 * amount is rounded. Two calls a minute apart produce byte-identical text.
 *
 * **It has to be small.** A year of expenses is thousands of rows and none of
 * the model's answers get better for having all of them. Detail is spent where
 * questions actually land: recent transactions in full, older spending rolled
 * up per category per month.
 *
 * **The derived figures come pre-computed.** Free cash flow, debt-to-income,
 * the balance on every loan and the interest it will cost — all of it is
 * computed by the same code the app's own screens use and handed over as
 * finished numbers. Asking a model to re-derive an amortization schedule from a
 * rate and a balance is asking it to be wrong occasionally and confidently, and
 * the answer would not match what the person is looking at.
 *
 * The renderer is **pure**: rows in, text out. That is what lets the scenario
 * harness build a synthetic financial life and get the exact context a real
 * account would produce.
 */

export interface SnapshotOptions {
  /** The reader's calendar day, `YYYY-MM-DD`. Their day, not the server's. */
  today: string;
  /** How many recent transactions to list individually. */
  recentLimit?: number;
  /** How many complete months of per-category history to roll up. */
  months?: number;
  /** Leave out the sections a narrow task doesn't need. */
  include?: {
    debts?: boolean;
    income?: boolean;
    assets?: boolean;
    budgets?: boolean;
    recent?: boolean;
    history?: boolean;
  };
}

export interface FinanceSnapshot {
  /** The cacheable context block, as plain text. */
  text: string;
  currency: 'USD' | 'INR';
  /** Rough size, for logging and budget checks. */
  approxTokens: number;
  counts: { expenses: number; subscriptions: number; budgets: number; debts: number; incomeSources: number };
  /** The same figures the text describes, for a caller that needs them typed. */
  position: FinancialPosition;
}

/** UTC day key — for anything already stored at UTC midnight. */
const utcDay = (value: string): string => new Date(value).toISOString().slice(0, 10);

const monthOf = (day: string) => day.slice(0, 7);

/** Two decimals, as a string, so the same figure never renders two ways. */
const money = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

/**
 * A duration in months, written so a short one stays legible.
 *
 * `Math.round(0.44)` is 0, and "0 months of cover" reads as a rounding artefact
 * rather than as the alarming fact it is. Under two months the decimal earns
 * its place; past that it is noise.
 */
const monthsLabel = (value: number): string =>
  value < 2 ? value.toFixed(1) : String(Math.round(value));

const pct = (fraction: number | null): string =>
  fraction === null ? 'unknown' : `${Math.round(fraction * 100)}%`;

/** A section, but only when there is something to say. Keeps empty ones out. */
const section = (heading: string, lines: string[]): string =>
  lines.length === 0 ? '' : `\n## ${heading}\n${lines.join('\n')}\n`;

const FREQ_PER_YEAR: Record<string, number> = { daily: 365, weekly: 52, monthly: 12, yearly: 1 };

/** The `months` complete month keys before the one `today` falls in, oldest first. */
function monthWindow(today: string, months: number): string[] {
  const current = monthOf(today);
  return Array.from({ length: months }, (_, i) => addMonthsToKey(current, -(months - i)));
}

export function renderSnapshot(
  data: PositionInput,
  { today, recentLimit = 40, months = 6, include = {} }: SnapshotOptions
): FinanceSnapshot {
  const want = {
    debts: include.debts !== false,
    income: include.income !== false,
    assets: include.assets !== false,
    budgets: include.budgets !== false,
    recent: include.recent !== false,
    history: include.history !== false,
  };

  const position = buildPosition({ ...data, today });
  const currency = position.currency;
  const symbol = currency === 'INR' ? '₹' : '$';

  const window = monthWindow(today, months);
  const windowStart = window[0] ?? monthOf(today);
  const currentMonth = monthOf(today);
  const columns = [...window, currentMonth];

  // ── Per-category monthly rollup ───────────────────────────────────────────
  //
  // Zero-filled across the window: a month with no spending has to count as a
  // real zero, or "you spend this every month" and "you spent it once" become
  // indistinguishable.
  const byCategory = new Map<string, Map<string, { amount: number; count: number }>>();
  let lifetimeTotal = 0;

  for (const e of data.expenses) {
    lifetimeTotal += e.amount;
    const month = monthOf(expenseDay(e.date));
    if (month < windowStart) continue;
    const perMonth = byCategory.get(e.category) ?? new Map();
    const cell = perMonth.get(month) ?? { amount: 0, count: 0 };
    cell.amount += e.amount;
    cell.count += 1;
    perMonth.set(month, cell);
    byCategory.set(e.category, perMonth);
  }

  const categoryRows = [...byCategory.entries()]
    .map(([category, perMonth]) => {
      const cells = columns.map(m => perMonth.get(m)?.amount ?? 0);
      const total = cells.reduce((sum, v) => sum + v, 0);
      const payments = columns.reduce((sum, m) => sum + (perMonth.get(m)?.count ?? 0), 0);
      return { category, cells, total, payments };
    })
    .filter(row => row.total > 0)
    .sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : 1))
    .map(row => {
      const spendClass = position.spending.byCategory.find(c => c.category === row.category)?.spendClass;
      const tag = spendClass === 'discretionary' ? ' | discretionary'
        : spendClass === 'essential' ? ' | essential'
        : spendClass === 'setting-aside' ? ' | set aside' : '';
      return `${row.category} | ${row.cells.map(money).join(' | ')} | ${row.payments} payments${tag}`;
    });

  // ── Recent transactions ───────────────────────────────────────────────────
  const recent = data.expenses.slice(0, recentLimit).map(e => {
    const tag = e.source === 'subscription' ? ' [auto: subscription]' : e.source === 'debt' ? ' [auto: instalment]' : '';
    const note = e.description ? ` — ${e.description.slice(0, 60)}` : '';
    return `${expenseDay(e.date)} | ${money(e.amount)} | ${e.category} | ${e.paymentMode ?? '—'}${note}${tag}`;
  });

  // ── Income ────────────────────────────────────────────────────────────────
  const incomeLines: string[] = [];
  if (want.income) {
    if (position.income.empty) {
      incomeLines.push('No income sources recorded. Anything that depends on income is unknown, not zero.');
    } else {
      for (const stream of position.income.streams) {
        const pay = stream.payDayOfMonth ? `, paid on the ${stream.payDayOfMonth}` : '';
        incomeLines.push(
          `${stream.name} | ${stream.type} | ${money(stream.amount)} ${stream.frequency} | ~${money(stream.monthly)}/mo | ${stream.reliability}${pay}`
        );
      }
      for (const one of position.income.oneOffs) {
        incomeLines.push(`${one.name} | ${one.type} | ${money(one.amount)} one-off (not counted as a monthly rate)`);
      }
      incomeLines.push(
        `TOTAL take-home: ${money(position.income.monthly)}/mo (${money(position.income.annual)}/yr).`
      );
      if (position.income.conservativeMonthly < position.income.monthly) {
        incomeLines.push(
          `On a lean month, assume ${money(position.income.conservativeMonthly)}/mo — some of this income is not guaranteed.`
        );
      }
    }
  }

  // ── Debts ─────────────────────────────────────────────────────────────────
  const debtLines: string[] = [];
  if (want.debts) {
    const active = position.debts.filter(d => d.status === 'active');
    for (const debt of active) {
      const payoff = debt.negativelyAmortizing
        ? `NEVER — ${money(debt.instalment)} a month does not cover ${money(debt.monthlyInterestCost)} of monthly interest, so the balance GROWS by about ${money(debt.monthlyInterestCost - debt.instalment)} every month`
        : debt.payoffDay
          ? `${debt.payoffDay} (${debt.periodsRemaining} instalments left)`
          : 'not projectable from the schedule on record';
      const interest =
        debt.interestRemaining === null
          ? 'interest still to pay: UNBOUNDED, it never stops'
          : `interest still to pay ${money(debt.interestRemaining)}`;
      const util = debt.utilization !== null ? `, ${Math.round(debt.utilization * 100)}% of limit used` : '';
      if (debt.prepaymentsMade.length > 0) {
        debtLines.push(
          `${debt.name} part payments already made: ${debt.prepaymentsMade.map(p => `${money(p.amount)} on ${p.day} (${p.effect})`).join('; ')}. ` +
            `Together they have removed about ${money(debt.interestSavedByPrepayments)} of interest. These are ALREADY reflected in the balance above — do not deduct them again.`
        );
      }
      if (debt.prepaymentsPlanned.length > 0) {
        debtLines.push(
          `${debt.name} part payments planned but NOT yet paid: ${debt.prepaymentsPlanned.map(p => `${money(p.amount)} on ${p.day}`).join('; ')}.`
        );
      }
      if (debt.rateHistory.length > 0) {
        const moves = debt.rateHistory.map(r => `${r.annualRate}% from ${r.effectiveFrom}`).join(', then ');
        debtLines.push(`${debt.name} rate history: ${moves}. It is ${debt.annualRate}% now.`);
      }
      debtLines.push(
        `${debt.name}${debt.lender ? ` (${debt.lender})` : ''} | ${debt.category} | balance ${money(debt.balance)} | ${debt.annualRate}% a year | ` +
          `${money(debt.instalment)} ${debt.frequency} (~${money(debt.monthlyCost)}/mo) | next due ${debt.nextDue ?? '—'} | ` +
          `${interest} | costing ${money(debt.monthlyInterestCost)}/mo in interest right now | paid off ${payoff}${util}`
      );
    }
    if (active.length > 0) {
      const unbounded = position.debtTotals.interestUnbounded;
      debtLines.push(
        `TOTAL owed ${money(position.debtTotals.balance)} across ${active.length} debt(s); ` +
          `${money(position.debtTotals.monthlyOutgo)}/mo in instalments; ` +
          `${money(position.debtTotals.monthlyInterestCost)}/mo of that is pure interest; ` +
          (unbounded.length > 0
            ? `AT LEAST ${money(position.debtTotals.interestRemaining)} of interest left, plus unlimited interest on ${unbounded.join(' and ')} — that debt has no total because it is growing.`
            : `${money(position.debtTotals.interestRemaining)} of interest left if nothing changes.`)
      );
      if (position.debtTotals.highestRate) {
        debtLines.push(
          `Most expensive: ${position.debtTotals.highestRate.name} at ${position.debtTotals.highestRate.annualRate}%. ` +
            `Smallest balance: ${position.debtTotals.smallestBalance?.name ?? '—'}.`
        );
      }
    }
    const closed = position.debts.filter(d => d.status === 'closed');
    if (closed.length > 0) debtLines.push(`Cleared: ${closed.map(d => d.name).join(', ')}.`);
  }

  // ── Balances ──────────────────────────────────────────────────────────────
  const assetLines: string[] = [];
  if (want.assets && data.assets.length > 0) {
    for (const asset of [...data.assets].sort((a, b) => b.balance - a.balance)) {
      const purpose = (asset.earmarkedFor ?? '').trim() || asset.name;
      const flags = [
        asset.liquid === false ? 'not liquid' : 'liquid',
        asset.ringFenced
          ? `ring-fenced for ${purpose} — do not offer it for anything else, but it IS available for ${purpose} itself`
          : '',
      ].filter(Boolean);
      assetLines.push(`${asset.name} | ${asset.kind} | ${money(asset.balance)} | as of ${asset.asOf} | ${flags.join(', ')}`);
    }
    assetLines.push(
      `TOTAL ${money(position.assets.total)}; liquid ${money(position.assets.liquid)}; ` +
        `spendable without breaking a ring-fence ${money(position.assets.available)}. ` +
        `Net worth (balances minus debt) ${money(position.assets.netWorth)}.`
    );
  } else if (want.assets) {
    assetLines.push('No savings or account balances recorded, so "do they have the money" cannot be answered — only "could they fund it from income".');
  }

  // ── Budgets ───────────────────────────────────────────────────────────────
  const budgetLines: string[] = [];
  if (want.budgets) {
    for (const b of data.budgets.slice(0, 4)) {
      const start = utcDay(b.startDate);
      const end = utcDay(b.endDate);
      const state = b.isDraft ? ' [DRAFT]' : b.isActive ? ' [ACTIVE]' : '';
      const allocations = [
        ...(b.categories ?? []).map(c => `${c.name} ${money(c.allocatedAmount)}`),
        ...(b.investments ?? []).map(c => `${c.name} ${money(c.allocatedAmount)} (investment)`),
        ...(b.savings ?? []).map(c => `${c.name} ${money(c.allocatedAmount)} (savings)`),
      ];
      const subs = (b.subscriptions ?? []).map(s => `${s.name} ${money(s.amount)} ${s.frequency}`);
      const debts = (b.debts ?? []).map(d => `${d.name} ${money(d.amount)}`);
      budgetLines.push(
        `${start} to ${end}${state} | income ${money(b.income ?? 0)}`,
        allocations.length > 0 ? `  plan: ${allocations.join(', ')}` : '  plan: nothing allocated',
        ...(subs.length > 0 ? [`  subscriptions in plan: ${subs.join(', ')}`] : []),
        ...(debts.length > 0 ? [`  instalments in plan: ${debts.join(', ')}`] : [])
      );
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const subLines = position.subscriptions.list.map(s => {
    const perYear = FREQ_PER_YEAR[s.frequency] ?? 12;
    const auto = s.autoRecord === false ? 'manual' : 'auto-records';
    return `${s.name} | ${money(s.amount)} ${s.frequency} | ~${money((s.amount * perYear) / 12)}/mo | ${s.category} | ${auto}`;
  });

  // ── The headline position ─────────────────────────────────────────────────
  //
  // Put first, and stated as finished arithmetic. These are the figures nearly
  // every question resolves to, and a model that has to assemble them from four
  // sections below will occasionally assemble them differently from the app.
  const positionLines = [
    `Take-home income: ${position.income.empty ? 'not recorded' : `${money(position.income.monthly)}/mo`}`,
    `Committed outgo: ${money(position.commitments.total)}/mo (instalments ${money(position.commitments.debt)}, subscriptions ${money(position.commitments.subscriptions)})`,
    `Typical variable spending: ${money(position.spending.variableMonthly)}/mo (median of ${position.spending.monthsObserved} complete months)`,
    `  of which ${money(position.spending.essentialMonthly)}/mo is essentials and ${money(position.spending.discretionaryMonthly)}/mo is discretionary`,
    `  ("discretionary" is the SUM of every optional category, not any single one. Per-category figures are in the table below.)`,
    ...(position.spending.setAsideMonthly > 0
      ? [`  plus ${money(position.spending.setAsideMonthly)}/mo moved into savings or investments — spent from the account but still theirs`]
      : []),
    `Free cash flow: ${money(position.freeCashflowMonthly)}/mo — income minus commitments minus a normal month of spending${
      position.freeCashflowConservative !== position.freeCashflowMonthly
        ? `, or ${money(position.freeCashflowConservative)}/mo on a lean month`
        : ''
    }`,
    // Named "unspent", not "saved". Nothing here says the money reaches a
    // savings account — for someone whose card balance is climbing it plainly
    // does not — and calling headroom a savings rate is the kind of claim that
    // sounds like a measurement and is not one.
    `Debt-to-income: ${pct(position.debtToIncome)}. Left unspent each month: ${pct(position.savingsRate)} of income.`,
    `Spendable balances: ${money(position.assets.available)}. With no income at all that is ${position.runwayMonths === null ? 'an unknown number of' : monthsLabel(position.runwayMonths)} months of normal outgo.`,
    ...(position.monthsUntilBroke !== null
      ? [
          `RUNNING A SHORTFALL of ${money(Math.abs(position.freeCashflowMonthly))}/mo at the current income. At that rate the balances are gone in ${monthsLabel(position.monthsUntilBroke)} months. This is the figure to quote for "how long can I last" — not the no-income one above.`,
        ]
      : []),
    `Spent so far this month (${currentMonth}, incomplete): ${money(position.spending.thisMonthSoFar)}`,
    // Handed over finished. Two models given the raw numbers computed "how is
    // this month going" two different ways and disagreed by tens of percent;
    // whichever one reached the screen would have been arbitrary.
    position.spending.pace.status === 'too-early'
      ? `PACE: too early in the month, or too little history, to compare this month against a normal one. Say so rather than estimating.`
      : `PACE: by day ${position.spending.pace.dayOfMonth} of a month they have usually spent ${money(position.spending.pace.typicalByNow)} (median of ${position.spending.pace.monthsCompared} previous months measured to the SAME day). This month they are at ${money(position.spending.pace.soFar)} — ${Math.round((position.spending.pace.ratio ?? 1) * 100)}% of the usual pace, which counts as "${position.spending.pace.status}". Use these figures; do not prorate a monthly median across the days elapsed, which is a different and worse comparison.`,
  ];

  const text = [
    `# Financial context`,
    ``,
    `Today is ${today}. All amounts are in ${currency} (${symbol}). Never convert to another currency.`,
    `Lifetime recorded spending: ${money(lifetimeTotal)} across ${data.expenses.length} payments.`,
    ``,
    `## Where they stand right now`,
    positionLines.join('\n'),
    ``,
    section(`Income`, incomeLines),
    section(`Debts`, debtLines),
    section(`Savings and balances`, assetLines),
    section(
      `Subscriptions`,
      subLines.length === 0
        ? []
        : [
            `${position.subscriptions.count} subscriptions, about ${money(position.subscriptions.monthly)} a month / ${money(position.subscriptions.annual)} a year.`,
            'name | price | monthly equivalent | category | recording',
            ...subLines,
          ]
    ),
    want.history
      ? section(
          `Monthly spending by category`,
          categoryRows.length === 0
            ? []
            : [
                `Columns: category | ${columns.join(' | ')} | payments | is it a choice`,
                `(the last column, ${currentMonth}, is the current month and is incomplete)`,
                ...categoryRows,
              ]
        )
      : '',
    section(`Budgets`, budgetLines),
    want.recent
      ? section(
          `Most recent payments`,
          recent.length === 0 ? [] : ['date | amount | category | method | note', ...recent]
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return {
    text,
    currency,
    // ~4 characters per token is close enough for a budget check and costs
    // nothing; the real count comes from the API's usage field.
    approxTokens: Math.ceil(text.length / 4),
    counts: {
      expenses: data.expenses.length,
      subscriptions: data.subscriptions.length,
      budgets: data.budgets.length,
      debts: data.debts.length,
      incomeSources: data.incomeSources.length,
    },
    position,
  };
}

export async function buildFinanceSnapshot(
  userId: string,
  options: SnapshotOptions
): Promise<FinanceSnapshot> {
  return renderSnapshot(await loadFinanceData(userId, options.today), options);
}
