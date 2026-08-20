import type { PositionInput, ExpenseRow, DebtRow, AssetRow, SubscriptionRow } from '../src/lib/financialPosition';
import type { IncomeStream } from '../src/lib/income';

/**
 * Twenty-six synthetic financial lives.
 *
 * These exist to answer a question that cannot be answered by reading the
 * prompt: *what does the assistant actually say to someone in trouble?* A
 * personal finance app has one user — the person who built it — and their
 * situation is one point in a space that includes a credit card compounding at
 * 42%, a freelancer whose income halves in a bad quarter, someone two months
 * into recording anything at all, and someone who has been laid off and is
 * burning through savings. Every one of those is a different failure mode for
 * a language model, and none of them show up in the author's own data.
 *
 * Each persona is a **generator**, not a fixture: given a `today` it produces
 * six to eighteen months of plausible history from a seeded RNG. Seeded because
 * an evaluation whose inputs change between runs cannot tell you whether a
 * prompt change helped.
 *
 * The personas are deliberately uncomfortable. A suite of well-run finances
 * would pass anything.
 */

// ── Deterministic randomness ────────────────────────────────────────────────

/**
 * mulberry32 — small, fast, and good enough for jittering a grocery bill.
 * The property that matters is that the same seed gives the same history
 * forever, so a regression is a regression and not a reroll.
 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

const addMonths = (day: string, months: number): string => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  at.setUTCDate(Math.min(d, last));
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
};

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// ── Spending profiles ───────────────────────────────────────────────────────

/**
 * A category's behaviour over a month: what it usually costs, how much it
 * varies, and how often it happens at all. Three numbers is enough to make a
 * history that a median can be taken of and that reads as a real person's.
 */
interface CategoryProfile {
  category: string;
  /** Typical total for the month. */
  monthly: number;
  /** Fractional spread, 0.2 = ±20%. */
  variance: number;
  /** Payments per month. 0.25 means roughly one every four months. */
  frequency: number;
  paymentMode?: string;
  /** Fractional month-on-month drift, compounding. 0.03 = climbing 3% a month. */
  drift?: number;
}

interface PersonaDefinition {
  id: string;
  title: string;
  /** What this persona is *for* — the failure mode it is meant to provoke. */
  probes: string;
  currency: 'USD' | 'INR';
  seed: number;
  /** How many complete months of history to generate. */
  months: number;
  income: IncomeStream[];
  debts: (today: string) => DebtRow[];
  assets: (today: string) => AssetRow[];
  subscriptions: SubscriptionRow[];
  spending: CategoryProfile[];
  /** Questions worth asking this particular person's assistant. */
  questions: string[];
}

// ── History generation ──────────────────────────────────────────────────────

function generateExpenses(
  profiles: CategoryProfile[],
  months: number,
  today: string,
  rng: () => number
): ExpenseRow[] {
  const rows: ExpenseRow[] = [];
  const [ty = 0, tm = 1] = today.split('-').map(Number);
  const todayDay = Number(today.slice(8, 10));

  // `months` complete months back, plus the partial current month — which is
  // what a real account looks like on any given day, and the case every
  // "compare this month to last" answer has to handle.
  for (let back = months; back >= 0; back--) {
    const monthStart = addMonths(`${ty}-${pad(tm)}-01`, -back);
    const [y = 0, m = 1] = monthStart.split('-').map(Number);
    const isCurrent = back === 0;
    const lastDay = isCurrent ? todayDay : daysInMonth(y, m);
    const monthFraction = isCurrent ? todayDay / daysInMonth(y, m) : 1;

    for (const profile of profiles) {
      const drift = Math.pow(1 + (profile.drift ?? 0), months - back);
      const target = profile.monthly * drift * monthFraction;
      if (target <= 0) continue;

      // An occasional category either happens this month or does not. Spreading
      // an annual insurance premium evenly across twelve months would erase
      // exactly the lumpiness the app's statistics exist to handle.
      const occurrences =
        profile.frequency < 1
          ? rng() < profile.frequency * (isCurrent ? monthFraction : 1) ? 1 : 0
          : Math.max(1, Math.round(profile.frequency * monthFraction));

      if (occurrences === 0) continue;

      const per = target / occurrences;
      for (let i = 0; i < occurrences; i++) {
        const jitter = 1 + (rng() - 0.5) * 2 * profile.variance;
        const day = Math.max(1, Math.min(lastDay, Math.floor(rng() * lastDay) + 1));
        const amount = Math.round(per * jitter * 100) / 100;
        if (amount <= 0) continue;
        rows.push({
          amount,
          category: profile.category,
          date: `${y}-${pad(m)}-${pad(day)}T12:00:00.000Z`,
          paymentMode: profile.paymentMode ?? 'Bank Transfer',
          source: 'manual',
        });
      }
    }
  }

  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Instalments and subscription charges, posted the way the app posts them. */
function generateCommittedCharges(
  debts: DebtRow[],
  subscriptions: SubscriptionRow[],
  months: number,
  today: string
): ExpenseRow[] {
  const rows: ExpenseRow[] = [];
  const [ty = 0, tm = 1] = today.split('-').map(Number);

  for (let back = months; back >= 0; back--) {
    const monthStart = addMonths(`${ty}-${pad(tm)}-01`, -back);
    const [y = 0, m = 1] = monthStart.split('-').map(Number);

    for (const debt of debts) {
      if (debt.status === 'closed' || debt.frequency !== 'monthly') continue;
      const due = Math.min(debt.dueDayOfMonth ?? 5, daysInMonth(y, m));
      const day = `${y}-${pad(m)}-${pad(due)}`;
      // Posted across the whole recorded window rather than only from the
      // balance date. That is what a real account looks like: someone has been
      // paying a loan for three years and enters *this month's* outstanding
      // figure, so the anchor is recent and the payment history is not.
      if (day > today) continue;
      rows.push({
        amount: debt.instalment,
        category: 'Debt Payments',
        date: `${day}T12:00:00.000Z`,
        description: debt.name,
        paymentMode: 'Bank Transfer',
        source: 'debt',
      });
    }

    for (const sub of subscriptions) {
      if (sub.frequency !== 'monthly') continue;
      const due = Math.min(sub.dueDayOfMonth ?? 1, daysInMonth(y, m));
      const day = `${y}-${pad(m)}-${pad(due)}`;
      if (day > today) continue;
      rows.push({
        amount: sub.amount,
        category: 'Subscriptions',
        date: `${day}T12:00:00.000Z`,
        description: sub.name,
        paymentMode: 'Credit Card',
        source: 'subscription',
      });
    }
  }

  return rows;
}

// ── Builders ────────────────────────────────────────────────────────────────

const salary = (amount: number, day = 1, name = 'Salary'): IncomeStream => ({
  name,
  type: 'Salary',
  amount,
  frequency: 'monthly',
  reliability: 'guaranteed',
  payDayOfMonth: day,
  active: true,
});

const loan = (
  over: Partial<DebtRow> & { name: string; category: string; openingBalance: number; instalment: number; annualRate: number; balanceAsOf: string }
): DebtRow => ({
  kind: 'amortizing',
  frequency: 'monthly',
  dueDayOfMonth: 5,
  lender: '',
  status: 'active',
  startDay: over.balanceAsOf,
  ...over,
});

const card = (
  over: Partial<DebtRow> & { name: string; openingBalance: number; instalment: number; annualRate: number; balanceAsOf: string }
): DebtRow => ({
  kind: 'revolving',
  category: 'Credit Card',
  frequency: 'monthly',
  dueDayOfMonth: 18,
  minimumFraction: 0.05,
  minimumFloor: 500,
  status: 'active',
  startDay: over.balanceAsOf,
  ...over,
});

const cash = (name: string, balance: number, asOf: string, over: Partial<AssetRow> = {}): AssetRow => ({
  name,
  kind: 'Cash & Bank',
  balance,
  asOf,
  liquid: true,
  ringFenced: false,
  earmarkedFor: '',
  ...over,
});

const sub = (name: string, amount: number, category = 'Entertainment', dueDayOfMonth = 5): SubscriptionRow => ({
  name,
  amount,
  frequency: 'monthly',
  category,
  autoRecord: true,
  dueDayOfMonth,
});

// ── The personas ────────────────────────────────────────────────────────────

export const PERSONAS: PersonaDefinition[] = [
  {
    id: 'salaried-comfortable',
    title: 'Salaried, two loans, comfortable',
    probes: 'The baseline. Everything is fine, and the assistant must not manufacture alarm to seem useful.',
    currency: 'INR',
    seed: 101,
    months: 8,
    income: [salary(162_000)],
    debts: today => [
      loan({ name: 'HDFC Home Loan', lender: 'HDFC', category: 'Home Loan', openingBalance: 4_820_000, instalment: 45_200, annualRate: 8.6, balanceAsOf: addMonths(today, -1), principal: 6_000_000, termMonths: 240, dueDayOfMonth: 5 }),
      loan({ name: 'Car Loan', lender: 'ICICI', category: 'Car Loan', openingBalance: 412_000, instalment: 18_400, annualRate: 9.2, balanceAsOf: addMonths(today, -1), principal: 900_000, termMonths: 60, dueDayOfMonth: 10 }),
    ],
    assets: today => [
      cash('Salary account', 240_000, addMonths(today, 0)),
      cash('Emergency fund', 600_000, addMonths(today, -1), { kind: 'Emergency Fund', ringFenced: true }),
      cash('Index funds', 1_450_000, addMonths(today, -1), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Spotify', 149), sub('Amazon Prime', 179, 'Shopping', 12)],
    spending: [
      { category: 'Food & Groceries', monthly: 18_000, variance: 0.18, frequency: 8 },
      { category: 'Dining Out', monthly: 9_500, variance: 0.4, frequency: 6 },
      { category: 'Transport', monthly: 4_200, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 5_400, variance: 0.15, frequency: 3 },
      { category: 'Healthcare', monthly: 3_000, variance: 0.9, frequency: 0.4 },
      { category: 'Shopping', monthly: 11_000, variance: 0.7, frequency: 3 },
      { category: 'Travel', monthly: 22_000, variance: 0.5, frequency: 0.25 },
    ],
    questions: [
      'How am I doing overall?',
      'Can I afford a 250000 rupee trip to Japan in December?',
      'Should I prepay the home loan or the car loan first?',
    ],
  },

  {
    id: 'credit-card-trap',
    title: 'Credit card compounding faster than it is being paid',
    probes: 'Negative amortization. This is the single most important fact about this person and it must lead every answer.',
    currency: 'INR',
    seed: 102,
    months: 7,
    income: [salary(68_000, 1)],
    debts: today => [
      card({ name: 'HDFC Regalia Card', lender: 'HDFC', openingBalance: 284_000, instalment: 9_000, annualRate: 42, balanceAsOf: addMonths(today, -1), creditLimit: 300_000 }),
      loan({ name: 'Personal Loan', lender: 'Bajaj', category: 'Personal Loan', openingBalance: 178_000, instalment: 8_900, annualRate: 18.5, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 7 }),
    ],
    assets: today => [cash('Savings account', 24_000, addMonths(today, 0))],
    subscriptions: [sub('Netflix', 649), sub('Hotstar', 299), sub('Gym', 1_800, 'Fitness & Wellness', 3)],
    spending: [
      { category: 'Food & Groceries', monthly: 12_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 7_800, variance: 0.5, frequency: 8, drift: 0.04 },
      { category: 'Transport', monthly: 3_400, variance: 0.3, frequency: 12 },
      { category: 'Utilities', monthly: 3_200, variance: 0.2, frequency: 3 },
      { category: 'Shopping', monthly: 6_500, variance: 0.8, frequency: 3 },
    ],
    questions: [
      'How am I doing overall?',
      'I want to buy a 90000 rupee phone on no-cost EMI over 12 months. Should I?',
      'Which debt should I clear first?',
      'Can I afford a weekend trip costing 15000?',
    ],
  },

  {
    id: 'freelancer-variable',
    title: 'Freelancer, income swings by 4x',
    probes: 'Variable income. An answer built on the average is wrong in the direction that hurts.',
    currency: 'INR',
    seed: 103,
    months: 10,
    income: [
      { name: 'Design retainers', type: 'Freelance', amount: 118_000, frequency: 'monthly', reliability: 'variable', typicalLow: 52_000, active: true },
      { name: 'Royalties', type: 'Other Income', amount: 9_000, frequency: 'quarterly', reliability: 'likely', active: true },
    ],
    debts: () => [],
    assets: today => [
      cash('Current account', 310_000, addMonths(today, 0)),
      cash('Tax set-aside', 420_000, addMonths(today, 0), { ringFenced: true }),
      cash('Mutual funds', 680_000, addMonths(today, -2), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [sub('Adobe CC', 4_230, 'Subscriptions'), sub('Figma', 1_250, 'Subscriptions'), sub('Notion', 700, 'Subscriptions')],
    spending: [
      { category: 'Food & Groceries', monthly: 15_000, variance: 0.25, frequency: 8 },
      { category: 'Dining Out', monthly: 11_000, variance: 0.6, frequency: 7 },
      { category: 'Housing & Rent', monthly: 38_000, variance: 0.02, frequency: 1 },
      { category: 'Transport', monthly: 5_000, variance: 0.4, frequency: 8 },
      { category: 'Utilities', monthly: 4_100, variance: 0.2, frequency: 3 },
      { category: 'Healthcare', monthly: 6_000, variance: 1.0, frequency: 0.3 },
    ],
    questions: [
      'Can I afford to take three months off next year?',
      'What should my monthly budget be?',
      'Can I afford a 400000 rupee car?',
    ],
  },

  {
    id: 'graduate-education-loan',
    title: 'First job, education loan, nothing saved',
    probes: 'Thin assets, real debt. The honest answer to most purchases is no, and it has to be said without lecturing.',
    currency: 'INR',
    seed: 104,
    months: 6,
    income: [salary(46_500)],
    debts: today => [
      loan({ name: 'Education Loan', lender: 'SBI', category: 'Education Loan', openingBalance: 780_000, instalment: 9_800, annualRate: 10.5, balanceAsOf: addMonths(today, -2), principal: 800_000, termMonths: 120, dueDayOfMonth: 8 }),
    ],
    assets: today => [cash('Savings account', 38_000, addMonths(today, 0))],
    subscriptions: [sub('Spotify', 119), sub('Netflix mobile', 199)],
    spending: [
      { category: 'Housing & Rent', monthly: 14_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 6_500, variance: 0.2, frequency: 8 },
      { category: 'Dining Out', monthly: 5_200, variance: 0.5, frequency: 9 },
      { category: 'Transport', monthly: 2_800, variance: 0.3, frequency: 14 },
      { category: 'Utilities', monthly: 1_900, variance: 0.2, frequency: 2 },
      { category: 'Shopping', monthly: 3_500, variance: 0.9, frequency: 2 },
    ],
    questions: [
      'Can I afford a 65000 rupee laptop?',
      'How long until I am debt free?',
      'What should my budget be?',
    ],
  },

  {
    id: 'dual-income-mortgage',
    title: 'Dual income, large mortgage, comfortable',
    probes: 'High absolute numbers with a healthy ratio. The assistant must not treat a big EMI as a problem by itself.',
    currency: 'INR',
    seed: 105,
    months: 12,
    income: [salary(198_000, 1, 'Salary — A'), salary(142_000, 5, 'Salary — B')],
    debts: today => [
      loan({ name: 'Home Loan', lender: 'Axis', category: 'Home Loan', openingBalance: 9_400_000, instalment: 108_000, annualRate: 8.9, balanceAsOf: addMonths(today, -1), principal: 11_000_000, termMonths: 240, dueDayOfMonth: 3 }),
    ],
    assets: today => [
      cash('Joint account', 520_000, addMonths(today, 0)),
      cash('Emergency fund', 1_200_000, addMonths(today, -1), { kind: 'Emergency Fund', ringFenced: true }),
      cash('Retirement', 3_800_000, addMonths(today, -3), { kind: 'Retirement', liquid: false }),
    ],
    subscriptions: [sub('Netflix', 899), sub('Prime', 179, 'Shopping'), sub('Apple One', 1_195), sub('Creche', 12_000, 'Childcare', 2)],
    spending: [
      { category: 'Food & Groceries', monthly: 32_000, variance: 0.15, frequency: 10 },
      { category: 'Dining Out', monthly: 18_000, variance: 0.4, frequency: 8 },
      { category: 'Childcare', monthly: 9_000, variance: 0.1, frequency: 1 },
      { category: 'Transport', monthly: 12_000, variance: 0.25, frequency: 8 },
      { category: 'Utilities', monthly: 9_800, variance: 0.15, frequency: 4 },
      { category: 'Travel', monthly: 40_000, variance: 0.6, frequency: 0.3 },
      { category: 'Shopping', monthly: 24_000, variance: 0.6, frequency: 5 },
    ],
    questions: [
      'How am I doing overall?',
      'Should we put 1500000 into the home loan or invest it?',
      'Can we afford a 1200000 rupee car?',
    ],
  },

  {
    id: 'over-committed',
    title: 'Four loans, 62% of income going to instalments',
    probes: 'Over-commitment without any single debt being catastrophic. The pattern is the finding.',
    currency: 'INR',
    seed: 106,
    months: 9,
    income: [salary(82_000)],
    debts: today => [
      loan({ name: 'Personal Loan', lender: 'Bajaj', category: 'Personal Loan', openingBalance: 340_000, instalment: 14_200, annualRate: 16.5, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 5 }),
      loan({ name: 'Two-wheeler Loan', category: 'Car Loan', openingBalance: 78_000, instalment: 4_100, annualRate: 12.5, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 8 }),
      card({ name: 'ICICI Card', openingBalance: 96_000, instalment: 12_000, annualRate: 38, balanceAsOf: addMonths(today, -1), creditLimit: 120_000 }),
      loan({ name: 'Consumer Durable EMI', category: 'Consumer Durable / BNPL', kind: 'interest-free', openingBalance: 42_000, instalment: 7_000, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 15 }),
      loan({ name: 'Gold Loan', lender: 'Muthoot', category: 'Gold Loan', openingBalance: 120_000, instalment: 13_500, annualRate: 14, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 20 }),
    ],
    assets: today => [cash('Savings account', 18_000, addMonths(today, 0))],
    subscriptions: [sub('Hotstar', 299), sub('YouTube Premium', 149)],
    spending: [
      { category: 'Housing & Rent', monthly: 16_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 9_000, variance: 0.2, frequency: 9 },
      { category: 'Transport', monthly: 3_200, variance: 0.3, frequency: 12 },
      { category: 'Utilities', monthly: 2_600, variance: 0.2, frequency: 2 },
      { category: 'Healthcare', monthly: 2_000, variance: 1.0, frequency: 0.3 },
    ],
    questions: [
      'How am I doing overall?',
      'Which loan should I clear first?',
      'Can I afford anything at all right now?',
      'What should my budget be?',
    ],
  },

  {
    id: 'debt-free-saver',
    title: 'No debt, high savings rate',
    probes: 'Nothing is wrong. The assistant must resist inventing a problem, and must not congratulate.',
    currency: 'INR',
    seed: 107,
    months: 12,
    income: [salary(124_000)],
    debts: () => [],
    assets: today => [
      cash('Savings account', 480_000, addMonths(today, 0)),
      cash('Emergency fund', 700_000, addMonths(today, 0), { kind: 'Emergency Fund' }),
      cash('Equity funds', 2_260_000, addMonths(today, -1), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Kindle Unlimited', 169, 'Education')],
    spending: [
      { category: 'Housing & Rent', monthly: 26_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 13_000, variance: 0.2, frequency: 8 },
      { category: 'Dining Out', monthly: 6_000, variance: 0.4, frequency: 5 },
      { category: 'Transport', monthly: 3_800, variance: 0.3, frequency: 9 },
      { category: 'Utilities', monthly: 3_400, variance: 0.15, frequency: 3 },
      { category: 'Mutual Funds', monthly: 30_000, variance: 0.02, frequency: 1 },
    ],
    questions: [
      'How am I doing overall?',
      'Can I afford a 800000 rupee car?',
      'Anything I should be worried about?',
    ],
  },

  {
    id: 'subscription-bloat',
    title: 'Fourteen subscriptions nobody has counted',
    probes: 'A finding that only appears when the annual figure is computed. Tests whether the totals get used.',
    currency: 'INR',
    seed: 108,
    months: 8,
    income: [salary(96_000)],
    debts: () => [],
    assets: today => [cash('Savings account', 210_000, addMonths(today, 0))],
    subscriptions: [
      sub('Netflix', 649), sub('Prime', 179, 'Shopping'), sub('Hotstar', 299), sub('Spotify', 179),
      sub('Apple iCloud', 219), sub('Google One', 210), sub('YouTube Premium', 149),
      sub('Adobe Photoshop', 1_690, 'Subscriptions'), sub('Gym', 2_400, 'Fitness & Wellness'),
      sub('Audible', 199, 'Education'), sub('Zomato Gold', 299, 'Dining Out'),
      sub('Swiggy One', 249, 'Dining Out'), sub('LinkedIn Premium', 1_400, 'Education'),
      sub('Notion', 700, 'Subscriptions'),
    ],
    spending: [
      { category: 'Housing & Rent', monthly: 22_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 11_000, variance: 0.2, frequency: 8 },
      { category: 'Dining Out', monthly: 8_400, variance: 0.5, frequency: 9 },
      { category: 'Transport', monthly: 4_000, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 3_000, variance: 0.2, frequency: 3 },
    ],
    questions: [
      'Where is my money going?',
      'What could I cut without really noticing?',
      'How much do my subscriptions cost me a year?',
    ],
  },

  {
    id: 'no-income-recorded',
    title: 'Expenses recorded, income never entered',
    probes: 'The commonest real state of a new account. Every income-dependent figure must be reported as unknown, never as zero.',
    currency: 'INR',
    seed: 109,
    months: 7,
    income: [],
    debts: today => [
      loan({ name: 'Bike Loan', category: 'Car Loan', openingBalance: 64_000, instalment: 3_400, annualRate: 11, balanceAsOf: addMonths(today, -1) }),
    ],
    assets: () => [],
    subscriptions: [sub('Netflix', 649)],
    spending: [
      { category: 'Food & Groceries', monthly: 14_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 6_000, variance: 0.5, frequency: 7 },
      { category: 'Transport', monthly: 3_600, variance: 0.3, frequency: 11 },
      { category: 'Housing & Rent', monthly: 20_000, variance: 0.02, frequency: 1 },
    ],
    questions: [
      'How am I doing overall?',
      'Can I afford a 120000 rupee holiday?',
      'What is my savings rate?',
    ],
  },

  {
    id: 'us-student-loans',
    title: 'US salaried, student loans, 401k',
    probes: 'Dollar formatting and US debt shapes. Also that the currency is never converted or renamed.',
    currency: 'USD',
    seed: 110,
    months: 10,
    income: [salary(7_240, 15)],
    debts: today => [
      loan({ name: 'Federal Student Loan', lender: 'Nelnet', category: 'Education Loan', openingBalance: 41_800, instalment: 412, annualRate: 5.5, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 21 }),
      loan({ name: 'Auto Loan', category: 'Car Loan', openingBalance: 18_600, instalment: 486, annualRate: 6.9, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 12 }),
      card({ name: 'Chase Sapphire', openingBalance: 3_400, instalment: 400, annualRate: 24.99, balanceAsOf: addMonths(today, -1), creditLimit: 12_000 }),
    ],
    assets: today => [
      cash('Checking', 4_200, addMonths(today, 0)),
      cash('High-yield savings', 14_500, addMonths(today, 0), { kind: 'Emergency Fund' }),
      cash('401(k)', 68_000, addMonths(today, -2), { kind: 'Retirement', liquid: false }),
    ],
    subscriptions: [sub('Netflix', 22.99), sub('Spotify', 11.99), sub('Gym', 42, 'Fitness & Wellness'), sub('iCloud', 9.99)],
    spending: [
      { category: 'Housing & Rent', monthly: 1_950, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 620, variance: 0.2, frequency: 8 },
      { category: 'Dining Out', monthly: 380, variance: 0.5, frequency: 10 },
      { category: 'Transport', monthly: 180, variance: 0.3, frequency: 6 },
      { category: 'Gas & Fuel', monthly: 140, variance: 0.25, frequency: 4 },
      { category: 'Utilities', monthly: 210, variance: 0.2, frequency: 3 },
      { category: 'Healthcare', monthly: 180, variance: 0.8, frequency: 0.5 },
    ],
    questions: [
      'Can I afford a $3200 vacation in four months?',
      'Should I pay off the credit card or the auto loan first?',
      'How am I doing overall?',
    ],
  },

  {
    id: 'thin-history',
    title: 'Two months of recording, gig income',
    probes: 'Thin data. Medians are meaningless and every figure has to be flagged as provisional.',
    currency: 'INR',
    seed: 111,
    months: 2,
    income: [
      { name: 'Delivery earnings', type: 'Freelance', amount: 34_000, frequency: 'monthly', reliability: 'variable', typicalLow: 21_000, active: true },
    ],
    debts: today => [
      loan({ name: 'Bike EMI', category: 'Car Loan', openingBalance: 52_000, instalment: 4_200, annualRate: 13.5, balanceAsOf: addMonths(today, -2) }),
    ],
    assets: today => [cash('Savings account', 9_400, addMonths(today, 0))],
    subscriptions: [],
    spending: [
      { category: 'Housing & Rent', monthly: 9_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 5_400, variance: 0.3, frequency: 10 },
      { category: 'Gas & Fuel', monthly: 4_800, variance: 0.2, frequency: 12 },
      { category: 'Healthcare', monthly: 1_400, variance: 0.9, frequency: 0.5 },
    ],
    questions: [
      'What should my budget be?',
      'Can I afford a 30000 rupee phone?',
      'How much do I usually spend a month?',
    ],
  },

  {
    id: 'laid-off',
    title: 'Recently laid off, savings burning',
    probes: 'Income has ended. Runway is the only number that matters and it must be given in months.',
    currency: 'INR',
    seed: 112,
    months: 9,
    income: [
      { name: 'Salary (ended)', type: 'Salary', amount: 145_000, frequency: 'monthly', reliability: 'guaranteed', active: false, endDay: '2026-06-30' },
      { name: 'Consulting', type: 'Freelance', amount: 28_000, frequency: 'monthly', reliability: 'variable', typicalLow: 0, active: true },
    ],
    debts: today => [
      loan({ name: 'Home Loan', category: 'Home Loan', openingBalance: 3_100_000, instalment: 32_400, annualRate: 8.75, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 5 }),
      card({ name: 'Amex Card', openingBalance: 62_000, instalment: 6_000, annualRate: 36, balanceAsOf: addMonths(today, -1), creditLimit: 250_000 }),
    ],
    assets: today => [
      cash('Savings account', 380_000, addMonths(today, 0)),
      cash('Emergency fund', 620_000, addMonths(today, 0), { kind: 'Emergency Fund' }),
      cash('Equity funds', 940_000, addMonths(today, -1), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Prime', 179, 'Shopping'), sub('Gym', 2_800, 'Fitness & Wellness')],
    spending: [
      { category: 'Food & Groceries', monthly: 17_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 5_000, variance: 0.5, frequency: 5 },
      { category: 'Transport', monthly: 3_000, variance: 0.4, frequency: 8 },
      { category: 'Utilities', monthly: 6_200, variance: 0.15, frequency: 4 },
      { category: 'Healthcare', monthly: 4_000, variance: 0.8, frequency: 0.6 },
      { category: 'Insurance', monthly: 8_000, variance: 0.1, frequency: 0.34 },
    ],
    questions: [
      'How long can I last?',
      'What should I cut first?',
      'Should I use savings to clear the credit card?',
    ],
  },

  {
    id: 'idle-cash-vs-loan',
    title: 'Large idle balance sitting beside a home loan',
    probes: 'The prepayment case. The arithmetic is unambiguous and the assistant should reach for the tool.',
    currency: 'INR',
    seed: 113,
    months: 10,
    income: [salary(180_000)],
    debts: today => [
      loan({ name: 'Home Loan', lender: 'SBI', category: 'Home Loan', openingBalance: 5_600_000, instalment: 52_000, annualRate: 9.15, balanceAsOf: addMonths(today, -1), principal: 7_000_000, termMonths: 240, dueDayOfMonth: 5 }),
    ],
    assets: today => [
      cash('Savings account', 1_850_000, addMonths(today, 0)),
      cash('Emergency fund', 500_000, addMonths(today, 0), { kind: 'Emergency Fund', ringFenced: true }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Spotify', 179)],
    spending: [
      { category: 'Food & Groceries', monthly: 20_000, variance: 0.18, frequency: 9 },
      { category: 'Dining Out', monthly: 10_000, variance: 0.4, frequency: 6 },
      { category: 'Transport', monthly: 6_000, variance: 0.3, frequency: 8 },
      { category: 'Utilities', monthly: 6_000, variance: 0.15, frequency: 4 },
      { category: 'Shopping', monthly: 14_000, variance: 0.7, frequency: 4 },
    ],
    questions: [
      'What should I do with the money sitting in my savings account?',
      'If I put 1000000 into the home loan, what happens?',
      'How am I doing overall?',
    ],
  },

  {
    id: 'bnpl-stack',
    title: 'Five zero-interest BNPL plans running at once',
    probes: 'Interest-free debt that is still a cash-flow problem. Tests that "0% is free" is not the answer.',
    currency: 'INR',
    seed: 114,
    months: 6,
    income: [salary(58_000)],
    debts: today => [
      loan({ name: 'Phone — Bajaj EMI', category: 'Consumer Durable / BNPL', kind: 'interest-free', openingBalance: 48_000, instalment: 6_000, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 5 }),
      loan({ name: 'Laptop — HDFC EMI', category: 'Consumer Durable / BNPL', kind: 'interest-free', openingBalance: 54_000, instalment: 9_000, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 7 }),
      loan({ name: 'Washing machine EMI', category: 'Consumer Durable / BNPL', kind: 'interest-free', openingBalance: 21_000, instalment: 3_500, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 10 }),
      loan({ name: 'Furniture EMI', category: 'Consumer Durable / BNPL', kind: 'interest-free', openingBalance: 36_000, instalment: 4_500, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 12 }),
      loan({ name: 'Simpl / Lazypay', category: 'Consumer Durable / BNPL', kind: 'interest-free', openingBalance: 9_000, instalment: 4_500, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 20 }),
    ],
    assets: today => [cash('Savings account', 12_000, addMonths(today, 0))],
    subscriptions: [sub('Netflix', 649), sub('Spotify', 119)],
    spending: [
      { category: 'Housing & Rent', monthly: 13_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 8_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 4_500, variance: 0.5, frequency: 7 },
      { category: 'Transport', monthly: 2_800, variance: 0.3, frequency: 12 },
      { category: 'Utilities', monthly: 2_200, variance: 0.2, frequency: 2 },
    ],
    questions: [
      'These are all zero interest so they are fine, right?',
      'Can I afford another 40000 rupee EMI for a TV?',
      'When do these all end?',
    ],
  },

  {
    id: 'business-lumpy',
    title: 'Business owner, quarterly income, business loan',
    probes: 'Income that arrives four times a year. A monthly average hides a real cash-flow trough.',
    currency: 'INR',
    seed: 115,
    months: 12,
    income: [
      { name: 'Business drawings', type: 'Business', amount: 620_000, frequency: 'quarterly', reliability: 'likely', typicalLow: 120_000, active: true },
      { name: 'Shop rental', type: 'Rental', amount: 45_000, frequency: 'monthly', reliability: 'guaranteed', payDayOfMonth: 5, active: true },
    ],
    debts: today => [
      loan({ name: 'Business Loan', lender: 'Kotak', category: 'Business Loan', openingBalance: 1_820_000, instalment: 62_000, annualRate: 13.5, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 5 }),
      loan({ name: 'Home Loan', category: 'Home Loan', openingBalance: 2_400_000, instalment: 28_000, annualRate: 8.8, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 10 }),
    ],
    assets: today => [
      cash('Current account', 640_000, addMonths(today, 0)),
      cash('Fixed deposit', 1_500_000, addMonths(today, -2), { kind: 'Fixed Deposit' }),
    ],
    subscriptions: [sub('Tally', 1_800, 'Subscriptions'), sub('Zoho', 2_400, 'Subscriptions'), sub('Netflix', 649)],
    spending: [
      { category: 'Food & Groceries', monthly: 24_000, variance: 0.2, frequency: 10 },
      { category: 'Dining Out', monthly: 14_000, variance: 0.5, frequency: 8 },
      { category: 'Transport', monthly: 9_000, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 8_400, variance: 0.2, frequency: 4 },
      { category: 'Taxes', monthly: 40_000, variance: 0.3, frequency: 0.34 },
      { category: 'Travel', monthly: 30_000, variance: 0.6, frequency: 0.3 },
    ],
    questions: [
      'How am I doing overall?',
      'Can I afford to hire someone at 45000 a month?',
      'Will I be short before the next quarter comes in?',
    ],
  },

  {
    id: 'retiree-pension',
    title: 'Retired, pension only, medical costs climbing',
    probes: 'Fixed income with a rising category. The drift is the finding and a median hides it.',
    currency: 'INR',
    seed: 116,
    months: 12,
    income: [
      { name: 'Pension', type: 'Pension', amount: 64_000, frequency: 'monthly', reliability: 'guaranteed', payDayOfMonth: 1, active: true },
      { name: 'FD interest', type: 'Dividend & Interest', amount: 96_000, frequency: 'yearly', reliability: 'guaranteed', active: true },
    ],
    debts: () => [],
    assets: today => [
      cash('Savings account', 340_000, addMonths(today, 0)),
      cash('Fixed deposits', 2_800_000, addMonths(today, -1), { kind: 'Fixed Deposit' }),
    ],
    subscriptions: [sub('Newspaper', 400, 'Education'), sub('Netflix', 199)],
    spending: [
      { category: 'Food & Groceries', monthly: 14_000, variance: 0.15, frequency: 10 },
      { category: 'Healthcare', monthly: 9_000, variance: 0.3, frequency: 3, drift: 0.07 },
      { category: 'Utilities', monthly: 4_600, variance: 0.15, frequency: 4 },
      { category: 'Transport', monthly: 2_200, variance: 0.3, frequency: 6 },
      { category: 'Gifts & Donations', monthly: 5_000, variance: 0.8, frequency: 0.5 },
      { category: 'Insurance', monthly: 4_200, variance: 0.1, frequency: 0.25 },
    ],
    questions: [
      'Is anything changing that I should know about?',
      'Can I afford to give my grandson 200000 for his wedding?',
      'How long will my savings last if I stopped working entirely?',
    ],
  },

  {
    id: 'family-loan',
    title: 'Interest-free loan from family, no formal schedule',
    probes: 'Debt with no interest and a soft deadline. Should not be ranked alongside a 42% card.',
    currency: 'INR',
    seed: 117,
    months: 8,
    income: [salary(74_000)],
    debts: today => [
      loan({ name: 'Loan from parents', category: 'Family & Friends', kind: 'interest-free', openingBalance: 420_000, instalment: 10_000, annualRate: 0, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 5, lender: 'Family' }),
      card({ name: 'SBI Card', openingBalance: 58_000, instalment: 8_000, annualRate: 40, balanceAsOf: addMonths(today, -1), creditLimit: 100_000 }),
    ],
    assets: today => [cash('Savings account', 86_000, addMonths(today, 0))],
    subscriptions: [sub('Netflix', 499), sub('Spotify', 119)],
    spending: [
      { category: 'Housing & Rent', monthly: 18_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 10_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 5_500, variance: 0.5, frequency: 7 },
      { category: 'Transport', monthly: 3_400, variance: 0.3, frequency: 11 },
      { category: 'Utilities', monthly: 2_800, variance: 0.2, frequency: 3 },
    ],
    questions: [
      'I have 60000 spare. Where should it go?',
      'Which should I clear first, the family loan or the card?',
      'How am I doing overall?',
    ],
  },

  {
    id: 'two-cards-rate-gap',
    title: 'Two cards, 42% and 17%, small balances',
    probes: 'Avalanche versus snowball where the gap is small. The recommendation should say when it does not matter.',
    currency: 'INR',
    seed: 118,
    months: 7,
    income: [salary(92_000)],
    debts: today => [
      card({ name: 'Card A', openingBalance: 74_000, instalment: 9_000, annualRate: 42, balanceAsOf: addMonths(today, -1), creditLimit: 150_000 }),
      card({ name: 'Card B', openingBalance: 21_000, instalment: 4_000, annualRate: 17, balanceAsOf: addMonths(today, -1), creditLimit: 80_000, dueDayOfMonth: 24 }),
    ],
    assets: today => [cash('Savings account', 140_000, addMonths(today, 0))],
    subscriptions: [sub('Netflix', 649)],
    spending: [
      { category: 'Housing & Rent', monthly: 24_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 11_000, variance: 0.2, frequency: 8 },
      { category: 'Dining Out', monthly: 7_000, variance: 0.5, frequency: 8 },
      { category: 'Transport', monthly: 4_200, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 3_200, variance: 0.2, frequency: 3 },
    ],
    questions: [
      'Which card should I pay off first?',
      'I have 140000 saved. Should I just clear both cards?',
      'How much are these cards actually costing me?',
    ],
  },

  {
    id: 'lifestyle-creep',
    title: 'High earner spending almost all of it',
    probes: 'A large income and a 2% savings rate. The number is the finding, not the categories.',
    currency: 'INR',
    seed: 119,
    months: 12,
    income: [salary(412_000)],
    debts: today => [
      loan({ name: 'Home Loan', category: 'Home Loan', openingBalance: 8_200_000, instalment: 92_000, annualRate: 8.7, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 5 }),
      loan({ name: 'Luxury Car Loan', category: 'Car Loan', openingBalance: 2_400_000, instalment: 68_000, annualRate: 9.5, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 10 }),
    ],
    assets: today => [
      cash('Savings account', 310_000, addMonths(today, 0)),
      cash('Equity', 1_100_000, addMonths(today, -4), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [
      sub('Netflix Premium', 899), sub('Apple One', 1_195), sub('Club membership', 18_000, 'Fitness & Wellness'),
      sub('Personal trainer', 12_000, 'Fitness & Wellness'), sub('Prime', 179, 'Shopping'),
    ],
    spending: [
      { category: 'Food & Groceries', monthly: 42_000, variance: 0.2, frequency: 12 },
      { category: 'Dining Out', monthly: 58_000, variance: 0.4, frequency: 14, drift: 0.02 },
      { category: 'Shopping', monthly: 62_000, variance: 0.6, frequency: 8 },
      { category: 'Travel', monthly: 90_000, variance: 0.7, frequency: 0.5 },
      { category: 'Transport', monthly: 18_000, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 14_000, variance: 0.2, frequency: 4 },
      { category: 'Personal Care', monthly: 12_000, variance: 0.4, frequency: 4 },
    ],
    questions: [
      'How am I doing overall?',
      'Where is my money going?',
      'Can I afford a 3500000 rupee holiday home deposit?',
    ],
  },

  {
    id: 'ring-fenced',
    title: 'Emergency fund explicitly ring-fenced',
    probes: 'A balance the person has said not to touch. Suggesting it anyway is the failure.',
    currency: 'INR',
    seed: 120,
    months: 9,
    income: [salary(88_000)],
    debts: () => [],
    assets: today => [
      cash('Spending account', 42_000, addMonths(today, 0)),
      cash('Emergency fund — do not touch', 600_000, addMonths(today, 0), { kind: 'Emergency Fund', ringFenced: true }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Gym', 2_200, 'Fitness & Wellness')],
    spending: [
      { category: 'Housing & Rent', monthly: 25_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 12_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 6_400, variance: 0.5, frequency: 8 },
      { category: 'Transport', monthly: 4_000, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 3_600, variance: 0.2, frequency: 3 },
    ],
    questions: [
      'Can I afford a 180000 rupee trip next month?',
      'How much do I actually have to spend?',
    ],
  },

  {
    id: 'floating-rate',
    title: 'Home loan whose rate has moved twice',
    probes: 'Rate history. The projection must use the current rate, and the change is worth mentioning.',
    currency: 'INR',
    seed: 121,
    months: 12,
    income: [salary(155_000)],
    debts: today => [
      {
        ...loan({ name: 'Home Loan', lender: 'HDFC', category: 'Home Loan', openingBalance: 4_100_000, instalment: 38_000, annualRate: 9.4, balanceAsOf: addMonths(today, -1), principal: 5_000_000, termMonths: 240, dueDayOfMonth: 5 }),
        rateChanges: [
          { effectiveFrom: addMonths(today, -14), annualRate: 8.4 },
          { effectiveFrom: addMonths(today, -8), annualRate: 8.9 },
          { effectiveFrom: addMonths(today, -2), annualRate: 9.4 },
        ],
      },
    ],
    assets: today => [
      cash('Savings account', 420_000, addMonths(today, 0)),
      cash('Emergency fund', 550_000, addMonths(today, 0), { kind: 'Emergency Fund' }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Prime', 179, 'Shopping')],
    spending: [
      { category: 'Food & Groceries', monthly: 19_000, variance: 0.18, frequency: 9 },
      { category: 'Dining Out', monthly: 8_000, variance: 0.4, frequency: 6 },
      { category: 'Transport', monthly: 5_400, variance: 0.3, frequency: 9 },
      { category: 'Utilities', monthly: 5_800, variance: 0.15, frequency: 4 },
      { category: 'Shopping', monthly: 9_000, variance: 0.7, frequency: 3 },
    ],
    questions: [
      'My home loan rate went up. What does that mean for me?',
      'How much interest will I pay on the home loan in total?',
      'Should I increase my EMI?',
    ],
  },

  {
    id: 'prepayment-history',
    title: 'Home loan with two part-payments already made',
    probes: 'Past prepayments must be reflected in the balance, and must not be double-counted or re-suggested.',
    currency: 'INR',
    seed: 122,
    months: 12,
    income: [salary(210_000)],
    debts: today => [
      {
        ...loan({ name: 'Home Loan', lender: 'ICICI', category: 'Home Loan', openingBalance: 3_600_000, instalment: 41_000, annualRate: 8.85, balanceAsOf: addMonths(today, -10), principal: 5_500_000, termMonths: 240, dueDayOfMonth: 5 }),
        prepayments: [
          { day: addMonths(today, -7), amount: 300_000, effect: 'reduce-tenure' as const },
          { day: addMonths(today, -3), amount: 200_000, effect: 'reduce-tenure' as const },
        ],
      },
    ],
    assets: today => [
      cash('Savings account', 720_000, addMonths(today, 0)),
      cash('Emergency fund', 800_000, addMonths(today, 0), { kind: 'Emergency Fund', ringFenced: true }),
    ],
    subscriptions: [sub('Netflix', 899), sub('Apple One', 1_195)],
    spending: [
      { category: 'Food & Groceries', monthly: 24_000, variance: 0.18, frequency: 10 },
      { category: 'Dining Out', monthly: 12_000, variance: 0.4, frequency: 7 },
      { category: 'Transport', monthly: 7_000, variance: 0.3, frequency: 9 },
      { category: 'Utilities', monthly: 7_200, variance: 0.15, frequency: 4 },
      { category: 'Travel', monthly: 35_000, variance: 0.6, frequency: 0.3 },
    ],
    questions: [
      'What is left on my home loan?',
      'Should I make another part payment of 500000?',
      'How much have my part payments saved me so far?',
    ],
  },

  {
    id: 'stale-balances',
    title: 'Balances last confirmed eight months ago',
    probes: 'Stale data presented as current is the failure mode of every manual balance. It must be flagged.',
    currency: 'INR',
    seed: 123,
    months: 10,
    income: [salary(105_000)],
    debts: today => [
      loan({ name: 'Car Loan', category: 'Car Loan', openingBalance: 280_000, instalment: 12_800, annualRate: 9.4, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 8 }),
    ],
    assets: today => [
      cash('Savings account', 460_000, addMonths(today, -8)),
      cash('Mutual funds', 900_000, addMonths(today, -11), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [sub('Netflix', 649)],
    spending: [
      { category: 'Housing & Rent', monthly: 28_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 14_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 7_500, variance: 0.5, frequency: 8 },
      { category: 'Transport', monthly: 4_600, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 4_000, variance: 0.2, frequency: 3 },
    ],
    questions: [
      'Can I afford a 300000 rupee purchase?',
      'How much do I have saved?',
    ],
  },

  {
    id: 'medical-emergency',
    title: 'Gold loan and medical debt after a hospital stay',
    probes: 'Debt taken on under duress. Advice must be practical, not a lecture about planning ahead.',
    currency: 'INR',
    seed: 124,
    months: 8,
    income: [salary(64_000)],
    debts: today => [
      loan({ name: 'Gold Loan', lender: 'Muthoot', category: 'Gold Loan', openingBalance: 340_000, instalment: 16_000, annualRate: 15.5, balanceAsOf: addMonths(today, -3), dueDayOfMonth: 5 }),
      loan({ name: 'Hospital instalment plan', category: 'Medical Debt', kind: 'interest-free', openingBalance: 168_000, instalment: 14_000, annualRate: 0, balanceAsOf: addMonths(today, -3), dueDayOfMonth: 12 }),
    ],
    assets: today => [cash('Savings account', 21_000, addMonths(today, 0))],
    subscriptions: [sub('Netflix', 199)],
    spending: [
      { category: 'Housing & Rent', monthly: 12_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 8_500, variance: 0.2, frequency: 9 },
      { category: 'Healthcare', monthly: 6_000, variance: 0.6, frequency: 2 },
      { category: 'Transport', monthly: 2_400, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 2_400, variance: 0.2, frequency: 2 },
    ],
    questions: [
      'How am I doing overall?',
      'I cannot keep up with both payments. What do I do?',
      'What should my budget be?',
    ],
  },

  {
    id: 'phone-emi-question',
    title: 'Comfortable, asking about a phone on EMI',
    probes: 'The EMI branch of affordability, including whether a "no-cost" plan is treated correctly.',
    currency: 'INR',
    seed: 125,
    months: 9,
    income: [salary(118_000)],
    debts: today => [
      loan({ name: 'Car Loan', category: 'Car Loan', openingBalance: 320_000, instalment: 14_500, annualRate: 9.1, balanceAsOf: addMonths(today, -1), dueDayOfMonth: 7 }),
    ],
    assets: today => [
      cash('Savings account', 190_000, addMonths(today, 0)),
      cash('Emergency fund', 350_000, addMonths(today, 0), { kind: 'Emergency Fund' }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Spotify', 179), sub('iCloud', 219)],
    spending: [
      { category: 'Housing & Rent', monthly: 30_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 15_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 8_500, variance: 0.5, frequency: 8 },
      { category: 'Transport', monthly: 5_000, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 4_200, variance: 0.2, frequency: 3 },
    ],
    questions: [
      'Should I buy a 145000 rupee iPhone on a 12 month no-cost EMI, or pay cash?',
      // Self-contained on purpose. Each question is asked with no history, so a
      // bare "what would the EMI do" has no antecedent and the model was right
      // to ask which EMI — that was the harness being unfair, not a failure.
      'What would a 12000 a month phone EMI do to my monthly position?',
    ],
  },

  {
    id: 'rent-vs-buy',
    title: 'Renting, saving for a deposit, no debt',
    probes: 'A goal with a date. The projection tool should be used rather than a mental estimate.',
    currency: 'INR',
    seed: 126,
    months: 11,
    income: [salary(168_000), { name: 'Annual bonus', type: 'Bonus', amount: 400_000, frequency: 'yearly', reliability: 'likely', active: true }],
    debts: () => [],
    assets: today => [
      cash('Savings account', 280_000, addMonths(today, 0)),
      cash('House fund', 1_640_000, addMonths(today, 0), { kind: 'Fixed Deposit', ringFenced: true, earmarkedFor: 'house down payment' }),
      cash('Equity', 820_000, addMonths(today, -1), { kind: 'Stocks & Mutual Funds' }),
    ],
    subscriptions: [sub('Netflix', 649), sub('Gym', 3_200, 'Fitness & Wellness')],
    spending: [
      { category: 'Housing & Rent', monthly: 42_000, variance: 0.02, frequency: 1 },
      { category: 'Food & Groceries', monthly: 18_000, variance: 0.2, frequency: 9 },
      { category: 'Dining Out', monthly: 11_000, variance: 0.4, frequency: 8 },
      { category: 'Transport', monthly: 6_500, variance: 0.3, frequency: 10 },
      { category: 'Utilities', monthly: 5_000, variance: 0.2, frequency: 3 },
      { category: 'Home Down Payment', monthly: 40_000, variance: 0.05, frequency: 1 },
    ],
    questions: [
      'When can I afford a 4000000 rupee deposit?',
      'Am I saving enough for the house?',
      'Should I keep renting?',
    ],
  },
];

// ── Assembly ────────────────────────────────────────────────────────────────

export interface Persona {
  id: string;
  title: string;
  probes: string;
  questions: string[];
  data: PositionInput;
}

export function buildPersona(definition: PersonaDefinition, today: string): Persona {
  const rng = makeRng(definition.seed);
  const debts = definition.debts(today);
  const subscriptions = definition.subscriptions;

  const expenses = [
    ...generateExpenses(definition.spending, definition.months, today, rng),
    ...generateCommittedCharges(debts, subscriptions, definition.months, today),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    id: definition.id,
    title: definition.title,
    probes: definition.probes,
    questions: definition.questions,
    data: {
      today,
      currency: definition.currency,
      expenses,
      subscriptions,
      debts,
      incomeSources: definition.income,
      assets: definition.assets(today),
      budgets: [],
    },
  };
}

export function buildAllPersonas(today: string): Persona[] {
  return PERSONAS.map(definition => buildPersona(definition, today));
}
