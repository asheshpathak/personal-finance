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

const budgetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
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
  /** Expected take-home for the period. 0 means "not tracked". */
  income: {
    type: Number,
    default: 0,
  },
  // ── Sections ──────────────────────────────────────────────────────────────
  // `categories` predates the sectioned model and stays the expense section, so
  // every budget created before this change keeps working untouched.
  categories: [allocationSchema],
  investments: [allocationSchema],
  savings: [allocationSchema],
  subscriptions: [budgetSubscriptionSchema],
}, { timestamps: true });

export default mongoose.model('Budget', budgetSchema);
