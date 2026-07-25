export const EXPENSE_CATEGORIES = [
  'Food & Groceries',
  'Dining Out',
  'Transport',
  'Gas & Fuel',
  'Utilities',
  'Housing & Rent',
  'Maintenance',
  'Insurance',
  'Healthcare',
  'Fitness & Wellness',
  'Entertainment',
  'Vices (smoking/drinking)',
  'Shopping',
  'Clothing',
  'Personal Care',
  'Education',
  'Childcare',
  'Pets',
  'Gifts & Donations',
  'Travel',
  'Subscriptions',
  'Savings & Investments',
  'Debt Payments',
  'Taxes',
  'Other',
] as const;

/**
 * Where money is put to work. These are real expense categories too — a gold
 * purchase is recorded like any other payment — but they roll up under the
 * investment section of a budget instead of the spending section.
 */
export const INVESTMENT_CATEGORIES = [
  'Stocks',
  'Mutual Funds',
  'Gold',
  'Crypto',
  'Fixed Deposit',
  'Bonds',
  'Real Estate',
  'Retirement Fund',
  'Trading',
  'Other Investments',
] as const;

/** Money set aside rather than deployed — tracked against savings targets. */
export const SAVINGS_CATEGORIES = [
  'Emergency Fund',
  'General Savings',
  'Vacation Fund',
  'Home Down Payment',
  'Vehicle Fund',
  'Education Fund',
  'Other Savings',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];
export type SavingsCategory = (typeof SAVINGS_CATEGORIES)[number];

/** Drives the grouped category picker on the expense form. */
export const CATEGORY_GROUPS: { label: string; categories: readonly string[] }[] = [
  { label: 'Spending', categories: EXPENSE_CATEGORIES },
  { label: 'Investments', categories: INVESTMENT_CATEGORIES },
  { label: 'Savings', categories: SAVINGS_CATEGORIES },
];

export const ALL_CATEGORIES: readonly string[] = [
  ...EXPENSE_CATEGORIES,
  ...INVESTMENT_CATEGORIES,
  ...SAVINGS_CATEGORIES,
];

export type CategoryGroup = 'spending' | 'investments' | 'savings';

export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  spending: 'Spending',
  investments: 'Investments',
  savings: 'Savings',
};

const INVESTMENT_SET = new Set<string>(INVESTMENT_CATEGORIES);
const SAVINGS_SET = new Set<string>(SAVINGS_CATEGORIES);

/** Which section of the budget a recorded payment belongs to. */
export function categoryGroup(category: string): CategoryGroup {
  if (INVESTMENT_SET.has(category)) return 'investments';
  if (SAVINGS_SET.has(category)) return 'savings';
  return 'spending';
}
