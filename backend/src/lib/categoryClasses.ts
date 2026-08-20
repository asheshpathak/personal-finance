/**
 * Which spending is a choice.
 *
 * This split did not exist until the scenario suite made its absence visible.
 * Answering "what could I cut" from a category table means naming whichever
 * line is largest, and the largest line is almost always rent — advice that is
 * arithmetically sound and completely useless. The same gap made every
 * affordability answer weaker than it needed to be: "you are ₹40,000 short" is
 * a dead end, where "you are ₹40,000 short and you spend ₹58,000 a month on
 * things you chose" is a decision.
 *
 * The classification is a default, not a judgement. Someone's gym membership
 * may be the thing keeping them well and their groceries may be half takeaway;
 * the point is to have a sensible starting line, not to be right about anyone's
 * priorities. Nothing here is ever presented as what they *should* cut.
 */

/** Money that keeps a household running. Cutting these has real consequences. */
const ESSENTIAL = new Set([
  'Housing & Rent',
  'Utilities',
  'Food & Groceries',
  'Healthcare',
  'Insurance',
  'Childcare',
  'Education',
  'Transport',
  'Taxes',
  'Maintenance',
  'Debt Payments',
]);

/** Money that could stop next month without anything breaking. */
const DISCRETIONARY = new Set([
  'Dining Out',
  'Entertainment',
  'Shopping',
  'Clothing',
  'Travel',
  'Personal Care',
  'Fitness & Wellness',
  'Vices (smoking/drinking)',
  'Gifts & Donations',
  'Gas & Fuel',
  'Pets',
  'Subscriptions',
]);

/** Money that leaves the current account but stays yours. */
const SETTING_ASIDE = new Set([
  'Savings & Investments',
  'Stocks', 'Mutual Funds', 'Gold', 'Crypto', 'Fixed Deposit', 'Bonds',
  'Real Estate', 'Retirement Fund', 'Trading', 'Other Investments',
  'Emergency Fund', 'General Savings', 'Vacation Fund', 'Home Down Payment',
  'Vehicle Fund', 'Education Fund', 'Other Savings',
]);

export type SpendClass = 'essential' | 'discretionary' | 'setting-aside' | 'unclassified';

export function classifyCategory(category: string): SpendClass {
  if (SETTING_ASIDE.has(category)) return 'setting-aside';
  if (ESSENTIAL.has(category)) return 'essential';
  if (DISCRETIONARY.has(category)) return 'discretionary';
  // A category the app does not ship — someone's own. Counted as neither
  // rather than guessed into one, because guessing wrong here means telling a
  // person their medication is optional.
  return 'unclassified';
}

export { ESSENTIAL, DISCRETIONARY, SETTING_ASIDE };
