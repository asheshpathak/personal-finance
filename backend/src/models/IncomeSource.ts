import mongoose from 'mongoose';

/**
 * A stream of money coming in.
 *
 * Income lived in exactly one place before this: a number typed into each
 * budget. That is wrong in three ways at once — it has to be retyped every
 * period, nothing outside the budget page can see it, and it cannot represent
 * the ordinary case of a salary plus a rent plus an annual bonus. Every figure
 * in the app that depends on income was therefore either absent or quietly
 * approximated from spending.
 *
 * So income is an account-level collection, and a budget's income becomes a
 * *derived* figure it may override rather than the only place the number
 * exists.
 */

const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'half-yearly', 'yearly', 'one-off'] as const;

const INCOME_TYPES = [
  'Salary',
  'Freelance',
  'Business',
  'Rental',
  'Dividend & Interest',
  'Pension',
  'Bonus',
  'Reimbursement',
  'Family Support',
  'Other Income',
] as const;

export type IncomeFrequency = (typeof FREQUENCIES)[number];
export type IncomeType = (typeof INCOME_TYPES)[number];

/**
 * Instalments per year for each cadence.
 *
 * `one-off` is 0 on purpose: a signing bonus is real money but it is not a
 * *rate*, and folding it into "what I earn a month" is how someone ends up
 * planning a permanent lifestyle around a single payment. It is counted where
 * it lands and nowhere else.
 */
export const INCOME_PER_YEAR: Record<IncomeFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  'half-yearly': 2,
  yearly: 1,
  'one-off': 0,
};

const incomeSourceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: INCOME_TYPES, default: 'Salary' },
  /**
   * Take-home, not gross.
   *
   * The app has no payroll model and never will, so a gross figure would need a
   * tax engine per jurisdiction to be useful and would silently overstate every
   * "can I afford this" answer until it had one. Asking for the number that
   * actually lands in the account is both simpler and more honest.
   */
  amount: { type: Number, required: true, min: 0 },
  frequency: { type: String, enum: FREQUENCIES, default: 'monthly' },

  /** Day of the month it arrives, 1–31, for cash-flow timing. */
  payDayOfMonth: { type: Number, min: 1, max: 31, default: null },

  /**
   * How dependable it is. A salary and a freelance retainer with the same
   * monthly figure are not the same money: affordability advice that treats
   * them identically is wrong in the direction that hurts.
   */
  reliability: {
    type: String,
    enum: ['guaranteed', 'likely', 'variable'],
    default: 'guaranteed',
  },
  /**
   * For variable income: the worst month observed. Used as the conservative
   * base when the answer to "can I afford this" should not assume a good month.
   */
  typicalLow: { type: Number, default: null, min: 0 },

  /** A source that has started but not yet ended, `YYYY-MM-DD`. */
  startDay: { type: String, default: null },
  endDay: { type: String, default: null },

  active: { type: Boolean, default: true },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true });

incomeSourceSchema.index({ userId: 1, active: 1 });

export { FREQUENCIES, INCOME_TYPES };
export default mongoose.model('IncomeSource', incomeSourceSchema);
