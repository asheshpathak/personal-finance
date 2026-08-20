import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  paymentMode: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  description: {
    type: String,
    trim: true,
  },
  // ── Provenance ────────────────────────────────────────────────────────────
  /**
   * How this expense came to exist. `manual` is anything a person typed;
   * `subscription` is posted automatically when a recurring charge falls due.
   * Recorded so the two can be told apart in the UI and so an auto-posted row
   * can be reconciled against its source.
   */
  source: {
    type: String,
    enum: ['manual', 'subscription', 'debt'],
    default: 'manual',
  },
  /** The subscription that generated this, when source is `subscription`. */
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    default: null,
  },
  /** The debt that generated this, when source is `debt`. */
  debtId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Debt',
    default: null,
  },
  /**
   * The part-payment this row records, when it is one.
   *
   * Part-payments need their own identity rather than sharing `billingDay`: a
   * lump sum paid on the same day an instalment falls due is a second, separate
   * payment, and keying both on the day would make the idempotency index treat
   * the second one as a duplicate of the first and silently drop it.
   */
  debtPrepaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  /**
   * The calendar day this charge was *due*, as `YYYY-MM-DD`.
   *
   * A day key rather than a Date on purpose: it is the identity of one billing
   * occurrence, and comparing identities has to be exact. Two Dates for "the
   * 5th" that differ by a timezone offset would look like two separate
   * charges, which is precisely the duplicate this key exists to prevent.
   */
  billingDay: {
    type: String,
    default: null,
  },
}, { timestamps: true });

/**
 * The idempotency guarantee for auto-posted charges.
 *
 * Catch-up runs whenever the app is opened, so the same due date will be
 * considered many times. `partialFilterExpression` keeps the constraint off
 * manual expenses entirely — those have no subscription and are free to repeat.
 */
expenseSchema.index(
  { userId: 1, subscriptionId: 1, billingDay: 1 },
  {
    unique: true,
    partialFilterExpression: { source: 'subscription' },
    name: 'unique_subscription_charge_per_day',
  }
);

/**
 * The same guarantee for debt instalments.
 *
 * A separate index rather than a wider one: the constraint has to be "one
 * charge per debt per due day", and folding debts and subscriptions into a
 * single index would make a debt and a subscription that happen to share a due
 * day collide on a null field.
 */
expenseSchema.index(
  { userId: 1, debtId: 1, billingDay: 1 },
  {
    unique: true,
    partialFilterExpression: { source: 'debt', debtPrepaymentId: null },
    name: 'unique_debt_charge_per_day',
  }
);

/** One expense per recorded part-payment, however many times catch-up runs. */
expenseSchema.index(
  { userId: 1, debtPrepaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { debtPrepaymentId: { $type: 'objectId' } },
    name: 'unique_debt_prepayment',
  }
);

/** The dominant read on every page: this user's expenses, newest first. */
expenseSchema.index({ userId: 1, date: -1 });

export default mongoose.model('Expense', expenseSchema);
