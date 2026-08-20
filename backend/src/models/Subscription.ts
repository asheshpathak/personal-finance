import mongoose from 'mongoose';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export type Frequency = (typeof FREQUENCIES)[number];
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/**
 * The due-date fields, shared by the live schedule and by a pending change.
 *
 * A change to the due date must not retroactively move a charge that has
 * already been billed this cycle — the same rule app stores use, where editing
 * a renewal date takes effect at the next renewal. So an edit is *staged* here
 * rather than applied, and the charger promotes it once the current cycle ends.
 */
const scheduleFields = () => ({
  dueDayOfWeek: { type: String, enum: [...DAYS_OF_WEEK, null], default: null },
  dueDayOfMonth: { type: Number, min: 1, max: 31, default: null },
  dueMonth: { type: Number, min: 1, max: 12, default: null },
});

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  frequency: {
    type: String,
    enum: FREQUENCIES,
    required: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  ...scheduleFields(),

  // ── Automatic recording ───────────────────────────────────────────────────
  /** When on, each due date posts an expense by itself. */
  autoRecord: {
    type: Boolean,
    default: true,
  },
  /** Payment mode stamped on auto-posted charges. */
  paymentMode: {
    type: String,
    default: 'Bank Transfer',
    trim: true,
  },
  /**
   * The day the subscription starts billing, `YYYY-MM-DD`.
   *
   * Charges are never posted before this, which is what stops a subscription
   * added today from back-filling five years of history the moment it is saved.
   */
  startDay: {
    type: String,
    default: null,
  },
  /** The most recent due date already posted, `YYYY-MM-DD`. */
  lastChargedDay: {
    type: String,
    default: null,
  },

  // ── Staged due-date change ────────────────────────────────────────────────
  /**
   * A due-date edit waiting for the current cycle to finish. Null when there is
   * no pending change. `pendingEffectiveFrom` is the first day the new schedule
   * applies; until then the live fields above are what bills.
   */
  pendingSchedule: {
    type: new mongoose.Schema({
      ...scheduleFields(),
      frequency: { type: String, enum: FREQUENCIES, required: true },
    }, { _id: false }),
    default: null,
  },
  pendingEffectiveFrom: {
    type: String,
    default: null,
  },
}, { timestamps: true });

subscriptionSchema.index({ userId: 1, createdAt: -1 });

export { FREQUENCIES, DAYS_OF_WEEK };
export default mongoose.model('Subscription', subscriptionSchema);
