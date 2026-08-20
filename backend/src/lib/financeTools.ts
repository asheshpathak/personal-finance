import Anthropic from '@anthropic-ai/sdk';
import { Types } from 'mongoose';
import Expense from '../models/Expense';
import { loadPosition } from './loadPosition';
import { assessAffordability } from './affordability';
import { compareStrategies } from './debtStrategy';
import { amortize, prepaymentImpact, type DebtTerms } from './amortization';
import { projectCashflow } from './cashflowProjection';
import { draftBudget } from './budgetPlanner';
import type { FinancialPosition } from './financialPosition';
import { isDayKey } from './schedule';

/**
 * What the assistant can reach for.
 *
 * Two kinds of tool, and the distinction is the point of the file.
 *
 * `query_expenses` reaches **past the context window** — the snapshot carries
 * six months of rollups and the last forty payments, and cannot answer "what
 * did I spend at that restaurant in March last year".
 *
 * Everything else reaches for **the same code the app's own screens run**. That
 * is not about capability; a model can amortize a loan. It is about agreement.
 * If the assistant computes a payoff date by reasoning and the debts page
 * computes one by replaying the schedule, they will differ — occasionally, and
 * without warning — and a person who catches that once stops trusting both.
 * Routing every derived figure through one implementation makes them equal by
 * construction rather than by luck.
 *
 * The security property is structural rather than prompted: `userId` is
 * captured in a closure from the verified JWT and appears in no input schema,
 * so there is no sentence the model could emit that would read someone else's
 * data. **Nothing here writes.**
 */

/** Ceiling on rows returned to the model. Truncation is always declared. */
const MAX_ROWS = 150;

export const FINANCE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_expenses',
    description:
      'Search the signed-in person\'s full expense history — further back than the summary in your context. ' +
      'Use it when the question is about a specific period, merchant or category that the summary does not cover, ' +
      'or when you need exact per-payment detail. Read-only. ' +
      'Prefer group_by over listing rows when the question is about a total: it is exact and far smaller.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', description: 'Inclusive first day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Inclusive last day, YYYY-MM-DD.' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to these exact category names. Omit for all categories.',
        },
        search: {
          type: 'string',
          description: 'Case-insensitive substring match on the description — how to find a merchant, e.g. "swiggy".',
        },
        minAmount: { type: 'number', description: 'Only payments at or above this amount.' },
        groupBy: {
          type: 'string',
          enum: ['none', 'category', 'month', 'paymentMode', 'description'],
          description:
            'none returns individual payments (capped, newest first). Anything else returns exact totals and counts per group, which is what you want for "how much did I spend on X".',
        },
      },
    },
  },
  {
    name: 'check_affordability',
    description:
      'Work out whether the person can afford a specific purchase, trip or commitment. ' +
      'ALWAYS use this rather than reasoning it out yourself — it runs the same code the app\'s own answer comes from, ' +
      'weighing savings, the emergency buffer, monthly headroom, existing debt and income reliability. ' +
      'It returns a verdict, the figures behind it, and what is missing from the picture. Read-only; nothing is recorded.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'amount'],
      properties: {
        label: { type: 'string', description: 'What it is, in their words: "Japan trip", "iPhone 17".' },
        amount: {
          type: 'number',
          description:
            'Up-front cost in the account currency. Pass 0 for something with no purchase price but an ongoing cost — hiring someone, a rent rise, a new subscription — and put the monthly figure in recurringMonthly.',
        },
        when: { type: 'string', description: 'Target day, YYYY-MM-DD. Omit for as soon as possible.' },
        financing: {
          type: 'string',
          enum: ['cash', 'emi'],
          description: 'How they would pay. Use emi when they mention instalments, EMI or a payment plan.',
        },
        emiMonths: { type: 'number', description: 'Plan length in months, when financing is emi.' },
        emiRate: { type: 'number', description: 'Plan annual interest rate as a percentage. 0 for a no-cost EMI.' },
        recurringMonthly: {
          type: 'number',
          description: 'Any ongoing monthly cost the purchase creates — insurance, a data plan, fuel, upkeep.',
        },
        bufferMonths: {
          type: 'number',
          description: 'Months of outgo to keep untouched as an emergency buffer. Defaults to 3, or 6 if their income is variable.',
        },
        useEarmarked: {
          type: 'boolean',
          description:
            'Whether a ring-fenced fund saved for this exact purpose should count. Defaults to true and matches on the label, so a "house fund" counts towards a house and not towards a holiday. Pass false only if they say the fund is off limits.',
        },
      },
    },
  },
  {
    name: 'compare_debt_strategies',
    description:
      'Compare paying debts highest-rate-first (avalanche) against smallest-balance-first (snowball), ' +
      'and both against paying only the minimums. Use it for "which debt should I clear first", ' +
      '"how fast can I be debt free", or when someone has spare money and several debts. Read-only.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        extraMonthly: {
          type: 'number',
          description: 'Spare money per month on top of the instalments. 0 to compare orderings alone.',
        },
      },
    },
  },
  {
    name: 'simulate_debt_payment',
    description:
      'What a lump-sum part payment, or a permanently larger instalment, would do to one debt: ' +
      'interest saved, months saved, new payoff date. Use it for "should I put my bonus into the home loan" ' +
      'or "what if I paid 5000 more a month". Read-only — nothing is recorded against the debt.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['debtName', 'amount'],
      properties: {
        debtName: { type: 'string', description: 'The debt\'s name, exactly as it appears in the context.' },
        amount: { type: 'number', description: 'The lump sum, or the extra per instalment when mode is "extra-monthly".' },
        mode: {
          type: 'string',
          enum: ['lump-sum', 'extra-monthly'],
          description: 'lump-sum is one payment; extra-monthly is a permanently larger instalment.',
        },
        effect: {
          type: 'string',
          enum: ['reduce-tenure', 'reduce-emi'],
          description:
            'What the lender does with a lump sum. reduce-tenure keeps the instalment and ends the loan sooner (saves far more interest); reduce-emi keeps the end date and frees monthly cash. Defaults to reduce-tenure.',
        },
        day: { type: 'string', description: 'When the payment would be made, YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'project_cashflow',
    description:
      'Project the balance forward month by month, accounting for instalments that finish along the way, ' +
      'subscriptions, and a typical month of spending. Use it for "when could I afford X", ' +
      '"will I be short before the bonus", or any question about a point in the future. Read-only.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        months: { type: 'number', description: 'How many months ahead, 1 to 60. Defaults to 12.' },
        conservative: {
          type: 'boolean',
          description: 'Assume income lands at its unreliable end. Use when the person asks about a worst case.',
        },
        extraMonthly: {
          type: 'number',
          description: 'An extra monthly outgoing to test — a new EMI, a rent rise, a savings commitment.',
        },
        pauseIncomeMonths: {
          type: 'number',
          description:
            'Model income stopping for this many months — a sabbatical, time off, a layoff, parental leave, a gap between contracts. Instalments and subscriptions keep running.',
        },
        pauseFrom: {
          type: 'number',
          description: 'How many months from now the pause starts. 0 or omitted means immediately.',
        },
        incomeChangeMonthly: {
          type: 'number',
          description: 'A permanent change to monthly income. Negative for a pay cut, positive for a raise.',
        },
      },
    },
  },
  {
    name: 'draft_budget',
    description:
      'Build a complete budget for a period from everything on record: income, instalments, subscriptions, ' +
      'and per-category spending history. Returns proposed amounts with the reasoning behind each. ' +
      'Use it whenever the person wants to plan, or asks what a realistic budget looks like. ' +
      'Read-only — it returns a draft; the person saves it in the app.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        startDate: { type: 'string', description: 'First day of the period, YYYY-MM-DD. Defaults to the start of this month.' },
        endDate: { type: 'string', description: 'Last day, YYYY-MM-DD. Defaults to the end of this month.' },
        savingsTarget: {
          type: 'number',
          description: 'Fraction of what is left after commitments to steer into savings, e.g. 0.2 for 20%.',
        },
        conservative: { type: 'boolean', description: 'Plan against the lean-month income figure.' },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category names to leave out of the plan.',
        },
      },
    },
  },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Per-request state for the tool loop.
 *
 * The position is memoized because four of the six tools need it, building it
 * reads seven collections, and a conversation that asks two follow-up questions
 * would otherwise pay for it four times inside one turn.
 */
export interface ToolContext {
  userId: string;
  today: string;
  /** Prebuilt position, when the caller already has one. */
  position?: FinancialPosition | undefined;
  /**
   * Where `query_expenses` reads from.
   *
   * Injectable so the scenario harness can run the *entire* tool surface —
   * including the one tool that hits the database — against a synthetic
   * financial life held in memory. Without this seam, evaluating the assistant
   * would mean seeding twenty-five accounts into Mongo, and a harness that
   * expensive to run is a harness nobody runs.
   */
  queryExpenses?: ((args: Record<string, unknown>) => Promise<string>) | undefined;
}

function positionGetter(context: ToolContext): () => Promise<FinancialPosition> {
  let cached: Promise<FinancialPosition> | null = context.position
    ? Promise.resolve(context.position)
    : null;
  return () => {
    if (!cached) cached = loadPosition(context.userId, context.today);
    return cached;
  };
}

/**
 * Runs one tool call. Never throws: a thrown error inside an agentic loop turns
 * into a dead conversation, whereas a returned message lets the model say what
 * went wrong or try a different query.
 */
export function makeToolRunner(context: ToolContext) {
  const getPosition = positionGetter(context);

  return async function runTool(name: string, input: unknown): Promise<string> {
    const args = (input ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'query_expenses':
          return context.queryExpenses
            ? await context.queryExpenses(args)
            : await queryExpenses(context.userId, args);
        case 'check_affordability':
          return await runAffordability(await getPosition(), context.today, args);
        case 'compare_debt_strategies':
          return runStrategies(await getPosition(), context.today, args);
        case 'simulate_debt_payment':
          return runSimulateDebt(await getPosition(), context.today, args);
        case 'project_cashflow':
          return runProjection(await getPosition(), args);
        case 'draft_budget':
          return runDraftBudget(await getPosition(), context.today, args);
        default:
          return JSON.stringify({ error: `Unknown tool "${name}".` });
      }
    } catch (err) {
      console.error(`[ai] tool ${name} failed:`, err);
      return JSON.stringify({ error: `That lookup failed. Answer from the summary you already have, and say the figure is approximate.` });
    }
  };
}

// ── query_expenses ──────────────────────────────────────────────────────────

async function queryExpenses(userId: string, args: Record<string, unknown>): Promise<string> {
  const from = typeof args.from === 'string' && DAY.test(args.from) ? args.from : null;
  const to = typeof args.to === 'string' && DAY.test(args.to) ? args.to : null;

  if (!from || !to) {
    return JSON.stringify({ error: 'from and to must both be YYYY-MM-DD dates.' });
  }

  // Expenses are stored at local noon so their calendar day survives any
  // timezone. Widening the window by half a day at each end means the query
  // catches the boundary days wherever the reader is.
  const match: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    date: {
      $gte: new Date(`${from}T00:00:00.000Z`),
      $lte: new Date(`${to}T23:59:59.999Z`),
    },
  };

  if (Array.isArray(args.categories) && args.categories.length > 0) {
    match.category = { $in: args.categories.filter(c => typeof c === 'string').slice(0, 40) };
  }
  if (typeof args.search === 'string' && args.search.trim()) {
    match.description = { $regex: escapeRegex(args.search.trim().slice(0, 60)), $options: 'i' };
  }
  if (typeof args.minAmount === 'number' && Number.isFinite(args.minAmount)) {
    match.amount = { $gte: args.minAmount };
  }

  const groupBy = typeof args.groupBy === 'string' ? args.groupBy : 'none';

  if (groupBy === 'none') {
    const rows = await Expense.find(match)
      .select('amount category paymentMode date description source -_id')
      .sort({ date: -1 })
      .limit(MAX_ROWS)
      .lean();

    return JSON.stringify({
      from,
      to,
      count: rows.length,
      // Saying so matters: an answer built from a silently truncated set is
      // wrong in a way nobody can see.
      truncated: rows.length === MAX_ROWS,
      total: round2(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
      rows: rows.map(r => ({
        date: new Date(r.date as Date).toISOString().slice(0, 10),
        amount: round2(Number(r.amount) || 0),
        category: r.category,
        paymentMode: r.paymentMode,
        description: String(r.description ?? '').slice(0, 60),
        auto: r.source === 'subscription' ? 'subscription' : r.source === 'debt' ? 'instalment' : undefined,
      })),
    });
  }

  const keys: Record<string, unknown> = {
    category: '$category',
    paymentMode: '$paymentMode',
    description: '$description',
    month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' } },
  };
  const key = keys[groupBy];
  if (key === undefined) {
    return JSON.stringify({ error: `Unsupported groupBy "${groupBy}".` });
  }

  const groups = await Expense.aggregate([
    { $match: match },
    { $group: { _id: key, total: { $sum: '$amount' }, payments: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 60 },
  ]);

  return JSON.stringify({
    from,
    to,
    groupBy,
    // The grand total is computed over the groups the model is being shown, so
    // its own arithmetic can never disagree with the figure it is given.
    total: round2(groups.reduce((sum, g) => sum + (Number(g.total) || 0), 0)),
    groups: groups.map(g => ({
      key: g._id ?? '(none)',
      total: round2(Number(g.total) || 0),
      payments: g.payments,
    })),
  });
}

// ── check_affordability ─────────────────────────────────────────────────────

async function runAffordability(
  position: FinancialPosition,
  today: string,
  args: Record<string, unknown>
): Promise<string> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return JSON.stringify({ error: 'amount must be a positive number.' });
  }

  return JSON.stringify(
    assessAffordability(position, {
      label: typeof args.label === 'string' ? args.label.slice(0, 80) : 'this',
      amount,
      when: typeof args.when === 'string' && DAY.test(args.when) ? args.when : today,
      financing: args.financing === 'emi' ? 'emi' : 'cash',
      emiMonths: args.emiMonths != null ? Number(args.emiMonths) : undefined,
      emiRate: args.emiRate != null ? Number(args.emiRate) : undefined,
      recurringMonthly: args.recurringMonthly != null ? Number(args.recurringMonthly) : undefined,
      bufferMonths: args.bufferMonths != null ? Number(args.bufferMonths) : undefined,
      useEarmarked: args.useEarmarked !== false,
    })
  );
}

// ── compare_debt_strategies ─────────────────────────────────────────────────

function runStrategies(position: FinancialPosition, today: string, args: Record<string, unknown>): string {
  const active = position.debts.filter(d => d.status === 'active' && d.balance > 0);
  if (active.length === 0) {
    return JSON.stringify({ note: 'No active debts on record, so there is nothing to order.' });
  }

  const extra = Number(args.extraMonthly);
  const comparison = compareStrategies(
    active.map(d => ({
      name: d.name,
      kind: d.kind as DebtTerms['kind'],
      frequency: d.frequency,
      annualRate: d.annualRate,
      instalment: d.instalment,
      openingBalance: d.balance,
      balanceAsOf: today,
      dueDayOfMonth: d.dueDayOfMonth,
      dueDayOfWeek: d.dueDayOfWeek,
      dueMonth: d.dueMonth,
    })),
    Number.isFinite(extra) && extra > 0 ? extra : 0,
    today
  );

  return JSON.stringify(comparison);
}

// ── simulate_debt_payment ───────────────────────────────────────────────────

function runSimulateDebt(position: FinancialPosition, today: string, args: Record<string, unknown>): string {
  const debt = matchDebt(position, String(args.debtName ?? ''));

  if (!debt) {
    return JSON.stringify({
      error: `No debt called "${args.debtName}".`,
      available: position.debts.filter(d => d.status === 'active').map(d => d.name),
    });
  }

  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return JSON.stringify({ error: 'amount must be a positive number.' });
  }

  const terms: DebtTerms = {
    kind: debt.kind as DebtTerms['kind'],
    frequency: debt.frequency,
    annualRate: debt.annualRate,
    instalment: debt.instalment,
    openingBalance: debt.balance,
    balanceAsOf: today,
    dueDayOfMonth: debt.dueDayOfMonth,
    dueDayOfWeek: debt.dueDayOfWeek,
    dueMonth: debt.dueMonth,
  };

  const base = amortize(terms);

  if (args.mode === 'extra-monthly') {
    const raised = amortize({ ...terms, instalment: terms.instalment + amount });
    return JSON.stringify({
      debt: debt.name,
      balance: debt.balance,
      mode: 'extra-monthly',
      extraPerInstalment: round2(amount),
      newInstalment: round2(terms.instalment + amount),
      before: { payoffDay: base.payoffDay, interestRemaining: base.interestRemaining, instalments: base.periodsRemaining },
      after: { payoffDay: raised.payoffDay, interestRemaining: raised.interestRemaining, instalments: raised.periodsRemaining },
      interestSaved: round2(base.interestRemaining - raised.interestRemaining),
      instalmentsSaved: base.periodsRemaining - raised.periodsRemaining,
    });
  }

  const day = typeof args.day === 'string' && isDayKey(args.day) ? args.day : today;
  const effect = args.effect === 'reduce-emi' ? 'reduce-emi' : 'reduce-tenure';

  return JSON.stringify({
    debt: debt.name,
    balance: debt.balance,
    mode: 'lump-sum',
    amount: round2(amount),
    effect,
    day,
    ...prepaymentImpact(terms, { day, amount, effect }),
    // Both framings are useful and people conflate them. Offering the
    // comparison unasked is the point: the same money as a permanently larger
    // instalment is usually the better deal and almost nobody models it.
    ifPaidAsExtraMonthlyInstead: (() => {
      const spread = amount / 12;
      const raised = amortize({ ...terms, instalment: terms.instalment + spread });
      return {
        equivalentExtraPerMonth: round2(spread),
        payoffDay: raised.payoffDay,
        interestSaved: round2(base.interestRemaining - raised.interestRemaining),
      };
    })(),
  });
}

/**
 * Finds the debt the person means.
 *
 * Exact match, then a containment either way, then word overlap, and finally —
 * when there is only one active debt — that one. The last rule looks lazy and
 * is the most useful: an account with a single loan cannot be ambiguous, and
 * making the model guess its exact stored name is a round-trip that ends in a
 * visible "let me try that again".
 *
 * The scenario suite is what made the case. "Home Loan" against a debt stored
 * as "HDFC Home Loan" failed on both directions of `includes`, and the retry
 * leaked into the answer.
 */
function matchDebt(position: FinancialPosition, requested: string) {
  const wanted = requested.trim().toLowerCase();
  const active = position.debts.filter(d => d.status === 'active');
  const pool = active.length > 0 ? active : position.debts;

  if (!wanted) return pool.length === 1 ? pool[0] : undefined;

  const exact = pool.find(d => d.name.toLowerCase() === wanted);
  if (exact) return exact;

  const contains = pool.find(
    d => d.name.toLowerCase().includes(wanted) || wanted.includes(d.name.toLowerCase())
  );
  if (contains) return contains;

  // Word overlap, ignoring words that carry no identity. "ICICI Home Loan"
  // against "Home Loan" shares two meaningful words and nothing else does.
  const noise = new Set(['loan', 'card', 'the', 'my', 'emi', 'debt']);
  const words = wanted.split(/\s+/).filter(w => w.length > 2 && !noise.has(w));
  if (words.length > 0) {
    const scored = pool
      .map(d => {
        const haystack = `${d.name} ${d.lender} ${d.category}`.toLowerCase();
        return { debt: d, score: words.filter(w => haystack.includes(w)).length };
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return scored[0].debt;
  }

  // One debt cannot be the wrong one.
  return pool.length === 1 ? pool[0] : undefined;
}

// ── project_cashflow ────────────────────────────────────────────────────────

function runProjection(position: FinancialPosition, args: Record<string, unknown>): string {
  const months = Number.isFinite(Number(args.months)) ? Number(args.months) : 12;
  const projection = projectCashflow(position, months, {
    conservative: args.conservative === true,
    extraMonthly: args.extraMonthly != null ? Number(args.extraMonthly) : 0,
    pauseIncomeMonths: args.pauseIncomeMonths != null ? Number(args.pauseIncomeMonths) : 0,
    pauseFrom: args.pauseFrom != null ? Number(args.pauseFrom) : 0,
    incomeChangeMonthly: args.incomeChangeMonthly != null ? Number(args.incomeChangeMonthly) : 0,
  });

  return JSON.stringify({
    ...projection,
    // The month rows are the bulk of the payload and most questions need only
    // the shape. Twelve is a year; past that the detail stops earning its
    // tokens and the summary fields carry the answer.
    months: projection.months.slice(0, 24),
  });
}

// ── draft_budget ────────────────────────────────────────────────────────────

function runDraftBudget(position: FinancialPosition, today: string, args: Record<string, unknown>): string {
  const startDate = typeof args.startDate === 'string' && isDayKey(args.startDate)
    ? args.startDate
    : `${today.slice(0, 7)}-01`;
  const endDate = typeof args.endDate === 'string' && isDayKey(args.endDate)
    ? args.endDate
    : monthEnd(today);

  return JSON.stringify(
    draftBudget(position, { startDate, endDate }, {
      savingsTarget: args.savingsTarget != null ? Number(args.savingsTarget) : undefined,
      conservative: args.conservative === true,
      exclude: Array.isArray(args.exclude)
        ? (args.exclude as unknown[]).filter((c): c is string => typeof c === 'string')
        : undefined,
    })
  );
}

const monthEnd = (day: string): string => {
  const [y = 0, m = 1] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, '0')}`;
};
