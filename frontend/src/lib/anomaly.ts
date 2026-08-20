import { median, modifiedZ, quantile } from './robust';
import { toDayKey } from './dates';

/**
 * "That one's unusual."
 *
 * Anomaly detection on spending is easy to implement and very hard to make
 * *bearable*. A textbook z-score over raw amounts flags roughly everything: the
 * distribution is right-skewed, so the upper tail is permanently three sigma
 * out, and the interface fills with alarms about entirely normal Fridays. Every
 * rule below exists to kill a specific class of false alarm, and the gates
 * matter more than the statistic:
 *
 *  · **Work in log space.** Transaction amounts are close to log-normal. Taking
 *    logs first is what makes "unusually large" mean the same thing for a ₹40
 *    coffee and a ₹40,000 flight.
 *  · **Use the modified z-score.** Median and MAD, not mean and σ — one large
 *    payment must not raise the bar for detecting the next one.
 *  · **Require both tests.** A payment must be statistically extreme *and*
 *    multiples of the category's normal size. The AND is what removes the flood.
 *  · **Never flag a subscription.** A renewal is the opposite of a surprise.
 *  · **Stay silent on thin data.** Under ten payments in a category there is no
 *    baseline, and inventing one is worse than saying nothing.
 */

export interface AnomalyExpense {
  _id?: string;
  amount: number;
  category: string;
  description?: string;
  date: string;
  source?: 'manual' | 'subscription';
}

export interface Anomaly {
  id: string;
  expense: AnomalyExpense;
  /** Modified z-score in log space. Above 3.5 is the published flag threshold. */
  score: number;
  /** What this category normally costs. */
  typical: number;
  /** How many times the typical amount this payment was. */
  multiple: number;
  /** One sentence a person can read, with the figures in it. */
  reason: string;
}

/** The published Iglewicz–Hoaglin flagging threshold. 2.0 is exploratory only. */
const Z_THRESHOLD = 3.5;

/** A payment must also be this many times the category's normal size. */
const MULTIPLE_THRESHOLD = 2.5;

/** Below this many payments a category has no baseline worth using. */
const MIN_SAMPLE = 10;

/** How many of the most recent payments to consider flagging. */
const RECENT_WINDOW_DAYS = 45;

export interface AnomalyOptions {
  /**
   * Payments below this are never flagged however extreme they are.
   *
   * A ₹300 outlier in Coffee is statistically remarkable and humanly
   * irrelevant, and an interface that says so twice loses the right to be
   * believed the third time. Callers pass a fraction of monthly spend.
   */
  floor?: number;
  /** Most anomalies to return. Ranked, so the cut is by importance. */
  limit?: number;
  today?: string;
}

export function findAnomalies(
  expenses: AnomalyExpense[],
  { floor = 0, limit = 3, today = toDayKey() }: AnomalyOptions = {}
): Anomaly[] {
  // A renewal is scheduled, known and unsurprising by construction.
  const manual = expenses.filter(e => e.source !== 'subscription' && e.amount > 0);

  const byCategory = new Map<string, AnomalyExpense[]>();
  for (const e of manual) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  const cutoff = shiftDays(today, -RECENT_WINDOW_DAYS);
  const found: Anomaly[] = [];

  for (const [category, all] of byCategory) {
    if (all.length < MIN_SAMPLE) continue;

    const amounts = all.map(e => e.amount);
    const logs = amounts.map(a => Math.log(a));
    const typical = median(amounts);
    if (typical <= 0) continue;

    // A category whose payments are all but identical — a fixed weekly transfer
    // — has no meaningful upper tail, and the modified z-score's IQR fallback
    // would turn a rounding difference into a 6-sigma event.
    const spread = quantile(amounts, 0.75) - quantile(amounts, 0.25);
    if (spread <= 0) continue;

    for (const expense of all) {
      const day = toDayKey(new Date(expense.date));
      if (day < cutoff || day > today) continue;
      if (expense.amount < floor) continue;

      const multiple = expense.amount / typical;
      if (multiple < MULTIPLE_THRESHOLD) continue;

      const score = modifiedZ(Math.log(expense.amount), logs);
      if (score < Z_THRESHOLD) continue;

      found.push({
        id: expense._id ?? `${category}-${day}-${expense.amount}`,
        expense,
        score,
        typical,
        multiple,
        reason: `${multiple.toFixed(1)}× your usual ${category} payment.`,
      });
    }
  }

  // Ranked by how far out they are, not by recency: the point is the biggest
  // surprise, and a cap of three is what keeps this a signal rather than a feed.
  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}

function shiftDays(day: string, delta: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d + delta);
  return toDayKey(date);
}
