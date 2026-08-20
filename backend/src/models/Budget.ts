import mongoose from 'mongoose';

/** Shared shape of every planned line item, whatever section it belongs to. */
const allocationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  allocatedAmount: {
    type: Number,
    required: true,
  },
}, { _id: false });

/**
 * A subscription pulled into the plan. The id links back to the live
 * subscription; name/amount/frequency are snapshotted so a past budget still
 * reads correctly after the subscription is edited or deleted.
 */
const budgetSubscriptionSchema = new mongoose.Schema({
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    default: null,
  },
  name: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly'],
    required: true,
  },
}, { _id: false });

/**
 * An instalment pulled into the plan, snapshotted the same way a subscription
 * is — so a budget closed in March still reads correctly after the loan is
 * refinanced in June.
 */
const budgetDebtSchema = new mongoose.Schema({
  debtId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Debt',
    default: null,
  },
  name: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  /** How many instalments fall inside the period. Usually 1; not always. */
  instalments: {
    type: Number,
    default: 1,
  },
}, { _id: false });

const budgetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  /** Optional name — "March", "Post-bonus plan". Drafts especially need one. */
  label: {
    type: String,
    trim: true,
    default: '',
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  /**
   * A plan being worked on rather than one in force.
   *
   * The point of the state is that a draft can be *wrong* — half-filled,
   * over-allocated, built for a month that hasn't started — without any of that
   * leaking into the figures on the dashboard. Without it, the only way to work
   * on next month's plan is to make it active and live with a home screen
   * measuring today's spending against it.
   */
  isDraft: {
    type: Boolean,
    default: false,
  },
  /** Where the plan came from. Drafting with the assistant marks itself `ai`. */
  origin: {
    type: String,
    enum: ['manual', 'planner', 'ai'],
    default: 'manual',
  },
  /** Free text carried alongside the plan — why a line is what it is. */
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  /**
   * Expected take-home for the period.
   *
   * Still stored per budget, but no longer the only place income exists: it is
   * seeded from the account's income sources and kept as a snapshot, so a plan
   * written in March keeps the figure it was written against after a raise in
   * June. `incomeIsOverride` records whether the person changed it by hand,
   * which is what stops a later sync from silently discarding their number.
   */
  income: {
    type: Number,
    default: 0,
  },
  incomeIsOverride: {
    type: Boolean,
    default: false,
  },
  // ── Sections ──────────────────────────────────────────────────────────────
  // `categories` predates the sectioned model and stays the expense section, so
  // every budget created before this change keeps working untouched.
  categories: [allocationSchema],
  investments: [allocationSchema],
  savings: [allocationSchema],
  subscriptions: [budgetSubscriptionSchema],
  /**
   * Instalments, as their own section.
   *
   * Not folded into the spending section, because an EMI is not a choice made
   * inside a month — it is the money that was never available to allocate. A
   * plan that shows ₹68,000 of income and ₹42,000 of instalments as one
   * undifferentiated "Debt Payments" line invites exactly the mistake of
   * budgeting against a number that was never there.
   */
  debts: [budgetDebtSchema],
}, { timestamps: true });

/** Only one budget can be in force. Drafts are exempt — that is what they are for. */
budgetSchema.index({ userId: 1, isActive: 1, isDraft: 1 });

export default mongoose.model('Budget', budgetSchema);
