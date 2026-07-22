export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface SubscriptionLike {
  amount: number;
  frequency: Frequency;
}

export function toAnnualCost({ amount, frequency }: SubscriptionLike): number {
  switch (frequency) {
    case 'daily': return amount * 365;
    case 'weekly': return amount * 52;
    case 'monthly': return amount * 12;
    case 'yearly': return amount;
  }
}

export function computeSpendTotals(subscriptions: SubscriptionLike[]) {
  const yearly = subscriptions.reduce((sum, s) => sum + toAnnualCost(s), 0);
  return {
    daily: yearly / 365,
    weekly: yearly / 52,
    monthly: yearly / 12,
    yearly,
  };
}

export function toMonthlyEquivalent(subscription: SubscriptionLike): number {
  return toAnnualCost(subscription) / 12;
}

export interface CategorySpend {
  category: string;
  amount: number;
  percentage: number;
}

export function computeCategorySpend(
  subscriptions: (SubscriptionLike & { category: string })[]
): CategorySpend[] {
  const byCategory = new Map<string, number>();
  for (const sub of subscriptions) {
    const monthly = toMonthlyEquivalent(sub);
    byCategory.set(sub.category, (byCategory.get(sub.category) ?? 0) + monthly);
  }
  const total = [...byCategory.values()].reduce((sum, v) => sum + v, 0);
  return [...byCategory.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}
