import mongoose from 'mongoose';

/**
 * A debt: something owed, with a schedule for paying it back.
 *
 * The design choice that matters is what is *not* here. There is no
 * `currentBalance` that gets decremented, no stored amortization table, no
 * "remaining tenure" field. All of that is derived from `openingBalance` as of
 * `balanceAsOf`, replayed forward through the schedule and the prepayments —
 * see `lib/amortization.ts`.
 *
 * Storing a running balance is the obvious design and it breaks on the first
 * real edit. Record a part-payment you made three months ago and every figure
 * since then is wrong until something recomputes them; correct an interest rate
 * and you have to decide which historic rows to rewrite. Deriving means a
 * correction anywhere in the timeline is a single insert and everything
 * downstream is right on the next read, with no migration and nothing to
 * reconcile.
 */

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/**
 * How the balance behaves. This is not cosmetic — each kind uses different
 * arithmetic, and treating a credit card as a term loan produces a payoff date
 * that does not exist.
 */
const DEBT_KINDS = ['amortizing', 'revolving', 'interest-free'] as const;

/**
 * What the debt is *for*. Kept separate from `kind` because the two answer
 * different questions: kind decides the maths, category decides how it is
 * grouped, coloured and reasoned about ("is this good debt?").
 */
const DEBT_CATEGORIES = [
  'Home Loan',
  'Car Loan',
  'Personal Loan',
  'Education Loan',
  'Credit Card',
  'Gold Loan',
  'Business Loan',
  'Consumer Durable / BNPL',
  'Family & Friends',
  'Medical Debt',
  'Overdraft',
  'Other Debt',
] as const;

const PREPAYMENT_EFFECTS = ['reduce-tenure', 'reduce-emi'] as const;

export type DebtKind = (typeof DEBT_KINDS)[number];
export type DebtCategory = (typeof DEBT_CATEGORIES)[number];

const scheduleFields = () => ({
  dueDayOfWeek: { type: String, enum: [...DAYS_OF_WEEK, null], default: null },
  dueDayOfMonth: { type: Number, min: 1, max: 31, default: null },
  dueMonth: { type: Number, min: 1, max: 12, default: null },
});

/**
 * One part-payment, over and above the instalment.
 *
 * `effect` is stored rather than assumed, and the reason is money: on a
 * twenty-year home loan, putting a lump sum against the tenure instead of the
 * instalment routinely saves several times the lump sum itself in interest.
 * A default would be a guess about the single most consequential field here.
 */
const prepaymentSchema = new mongoose.Schema({
  day: { type: String, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  effect: { type: String, enum: PREPAYMENT_EFFECTS, default: 'reduce-tenure' },
  note: { type: String, trim: true, default: '' },
  /**
   * True once this has been posted as an expense. Part-payments are real money
   * leaving the account, so they belong in the spending history — but only
   * once, and only when they are not in the future.
   */
  recorded: { type: Boolean, default: false },
}, { _id: true, timestamps: true });

/** A floating rate moving. Kept as history so an old projection stays explicable. */
const rateChangeSchema = new mongoose.Schema({
  effectiveFrom: { type: String, required: true },
  annualRate: { type: Number, required: true, min: 0, max: 100 },
  note: { type: String, trim: true, default: '' },
}, { _id: true });

const debtSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: { type: String, required: true, trim: true },
  lender: { type: String, trim: true, default: '' },
  category: { type: String, enum: DEBT_CATEGORIES, required: true },
  kind: { type: String, enum: DEBT_KINDS, default: 'amortizing' },

  // ── The anchor ────────────────────────────────────────────────────────────
  /**
   * What was originally borrowed. Display and context only — nothing is derived
   * from it, because most debts are entered into this app years after they were
   * taken out and the original figure is no longer the useful one.
   */
  principal: { type: Number, default: 0, min: 0 },
  /** Balance outstanding on `balanceAsOf`. Every projection starts here. */
  openingBalance: { type: Number, required: true, min: 0 },
  balanceAsOf: { type: String, required: true },

  /** Nominal annual rate as a percentage. 0 for an interest-free debt. */
  annualRate: { type: Number, default: 0, min: 0, max: 100 },
  /** The contractual instalment; for revolving debt, what they intend to pay. */
  emiAmount: { type: Number, required: true, min: 0 },
  frequency: { type: String, enum: FREQUENCIES, default: 'monthly' },
  ...scheduleFields(),

  /** Original tenure in months. Context for the UI; not used in the maths. */
  termMonths: { type: Number, default: null, min: 0 },

  // ── Revolving terms ───────────────────────────────────────────────────────
  /** Minimum due as a fraction of balance, e.g. 0.05 for 5%. */
  minimumFraction: { type: Number, default: null, min: 0, max: 1 },
  /** Absolute floor under the minimum due. */
  minimumFloor: { type: Number, default: null, min: 0 },
  /** Agreed limit, for a utilisation figure. */
  creditLimit: { type: Number, default: null, min: 0 },

  // ── Events ────────────────────────────────────────────────────────────────
  prepayments: [prepaymentSchema],
  rateChanges: [rateChangeSchema],

  // ── Automatic recording ───────────────────────────────────────────────────
  /** When on, each due date posts an expense by itself, like a subscription. */
  autoRecord: { type: Boolean, default: true },
  paymentMode: { type: String, default: 'Bank Transfer', trim: true },
  /** First day this debt may post a charge, `YYYY-MM-DD`. */
  startDay: { type: String, default: null },
  /** The most recent due date already posted, `YYYY-MM-DD`. */
  lastChargedDay: { type: String, default: null },

  // ── Staged due-date change ────────────────────────────────────────────────
  // Same rule as subscriptions: moving a due date must not re-bill or skip the
  // cycle already paid, so the edit waits for the next cycle.
  pendingSchedule: {
    type: new mongoose.Schema({
      ...scheduleFields(),
      frequency: { type: String, enum: FREQUENCIES, required: true },
    }, { _id: false }),
    default: null,
  },
  pendingEffectiveFrom: { type: String, default: null },

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /**
   * `closed` is a statement about the future, not a delete. The instalments
   * already posted are real spending and stay in the history; a closed debt
   * simply stops projecting and stops charging.
   */
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  closedOn: { type: String, default: null },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true });

debtSchema.index({ userId: 1, status: 1, createdAt: -1 });

export { FREQUENCIES, DAYS_OF_WEEK, DEBT_KINDS, DEBT_CATEGORIES, PREPAYMENT_EFFECTS };
export default mongoose.model('Debt', debtSchema);
