import mongoose from 'mongoose';

/**
 * Something owned, tracked as a balance.
 *
 * This exists for one question: **can I afford this?** Nothing else in the app
 * needed it. Income tells you what arrives, the debts and subscriptions tell
 * you what leaves, and the spending history tells you what a normal month
 * costs — but none of that answers whether the ₹180,000 for a trip is *there*,
 * and an affordability answer that quietly assumes it is would be worse than
 * no answer at all.
 *
 * Deliberately a manually-maintained balance, not a transaction ledger. This
 * app connects to no bank and never will; asking someone to keep a savings
 * ledger by hand is asking for a number that is wrong in a month. One figure
 * with the date it was last confirmed is honest about what it is, and the
 * staleness is visible rather than hidden.
 */

const ASSET_KINDS = [
  'Cash & Bank',
  'Emergency Fund',
  'Fixed Deposit',
  'Stocks & Mutual Funds',
  'Retirement',
  'Gold',
  'Crypto',
  'Real Estate',
  'Other Asset',
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Which balances can be reached this week without a penalty or a sale.
 *
 * The distinction is the whole point of the model. A ₹2,000,000 flat and
 * ₹40,000 in a current account are both "assets" and only one of them can pay
 * for a holiday. Retirement money is excluded on purpose even where it is
 * technically withdrawable — an affordability answer that reaches into a
 * pension is not advice anyone should act on.
 */
const LIQUID_BY_DEFAULT: Record<AssetKind, boolean> = {
  'Cash & Bank': true,
  'Emergency Fund': true,
  'Fixed Deposit': true,
  'Stocks & Mutual Funds': true,
  Retirement: false,
  Gold: false,
  Crypto: true,
  'Real Estate': false,
  'Other Asset': false,
};

const assetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ASSET_KINDS, default: 'Cash & Bank' },
  balance: { type: Number, required: true, min: 0 },
  /**
   * When this figure was last confirmed, `YYYY-MM-DD`. Shown wherever the
   * balance is, because a six-month-old number presented as current is the
   * failure mode of every manually-maintained balance ever built.
   */
  asOf: { type: String, required: true },
  /**
   * Whether this can be spent without selling something or paying a penalty.
   * Defaulted from the kind and then editable — someone's "Emergency Fund" in a
   * five-year lock-in is not liquid, and only they know that.
   */
  liquid: { type: Boolean, default: true },
  /**
   * Excluded from "what could I spend" even when liquid. The emergency fund a
   * person refuses to touch for a holiday is real, and an app that keeps
   * offering it is an app they stop trusting.
   */
  ringFenced: { type: Boolean, default: false },
  /**
   * What a ring-fenced balance is *for*, in the person's own words: "house
   * down payment", "Japan trip", "the car".
   *
   * Without this, ring-fencing is a rule with no exception, and the scenario
   * suite showed what that costs: someone with ₹16,40,000 in a fund named
   * "House fund" asked when they could afford a house deposit and was told the
   * money was off limits. The fence exists to stop the app offering that money
   * up for a television. It was never meant to hide it from the one purchase it
   * was saved for.
   */
  earmarkedFor: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true });

assetSchema.index({ userId: 1, kind: 1 });

export { ASSET_KINDS, LIQUID_BY_DEFAULT };
export default mongoose.model('Asset', assetSchema);
