import { clamp, mean, median } from './robust';
import { addDays, fromDayKey, isValidDayKey, toDayKey } from './dates';
import { toAnnualCost, type Frequency } from './subscriptionTotals';

/**
 * Finding the recurring payments nobody told the app about.
 *
 * This app knows about the subscriptions someone typed in. It does not know
 * about the gym they pay by standing order and never registered, or the
 * streaming service whose price went up 20% last quarter. Those are exactly the
 * charges that quietly wreck a budget, because they are invisible *and*
 * unavoidable — the highest-shock-per-pixel screen in this category is a total
 * annual subscription burn nobody had added up.
 *
 * The pipeline is: normalise the description → group → check the amounts are
 * consistent → score the periodicity → gate on confidence. The gates are
 * everything. Three payments is not a pattern, a daily coffee is not a
 * subscription, and a false positive here asks someone to cancel something that
 * does not exist.
 */

export interface RecurringExpense {
  amount: number;
  category: string;
  description?: string;
  date: string;
  source?: 'manual' | 'subscription';
}

export interface DetectedRecurring {
  /** The tidied merchant key, e.g. "spotify". */
  key: string;
  /** The most readable original description in the group. */
  label: string;
  category: string;
  /** Typical charge. Median, because a price change must not skew it. */
  amount: number;
  /** The latest charge, which may differ from `amount` after a price change. */
  latestAmount: number;
  frequency: Frequency;
  /** Median gap in days — the observed cadence, before it was named. */
  medianGap: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** Estimated next charge, extrapolated from the cadence. */
  nextExpected: string;
  /** What this costs over a year at the current price. */
  annualCost: number;
  /** 0–1. Below 0.55 nothing is surfaced. */
  confidence: number;
  /** Set when the latest charge is meaningfully above the trailing median. */
  priceIncrease: { from: number; to: number; percent: number } | null;
}

/**
 * Strips everything that varies between two instances of the same charge.
 *
 * Reference numbers, transaction ids and rail names ("UPI", "NEFT", "POS") are
 * noise that makes two identical payments look like two different merchants.
 */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\b(pos|upi|neft|imps|rtgs|ref|txn|autopay|auto|payment|purchase|debit|credit|card|online)\b/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first couple of meaningful words — enough to identify, short enough to match. */
const groupKey = (normalized: string): string => normalized.split(' ').slice(0, 3).join(' ');

interface Candidate {
  key: string;
  label: string;
  category: string;
  entries: { day: string; amount: number }[];
}

/**
 * Named cadences and how much drift each tolerates.
 *
 * The tolerances are not decoration. A fortnightly charge legitimately lands 13
 * or 15 days apart; a monthly one drifts by up to four across 28-, 30- and
 * 31-day months. Demanding exactness here rejects most real subscriptions.
 */
const CADENCES: { frequency: Frequency; days: number; tolerance: number }[] = [
  { frequency: 'weekly', days: 7, tolerance: 1 },
  { frequency: 'weekly', days: 14, tolerance: 2 },
  { frequency: 'monthly', days: 30.4, tolerance: 4 },
  { frequency: 'monthly', days: 91.3, tolerance: 7 },
  { frequency: 'yearly', days: 365, tolerance: 15 },
];

/**
 * Under three occurrences nothing is a pattern.
 *
 * Two payments a month apart are two payments a month apart. The industry
 * convention treats fewer than three as a lower-confidence "early detection"
 * state rather than a finding, and this app has no use for that state.
 */
const MIN_OCCURRENCES = 3;

/** A charge more often than this is a habit, not a subscription. */
const HABIT_GAP_DAYS = 5;

/**
 * The share of charges that must sit within 15% of the typical amount.
 *
 * Two thirds, not all: a real subscription genuinely varies — a phone bill, a
 * utility, a plan with usage on top — and demanding exactness would reject most
 * of the ones worth finding. But a stream where only a third of the charges
 * cluster is not a price, it is a habit.
 */
const MIN_AMOUNT_STABILITY = 0.65;

export interface DetectOptions {
  /** Ignore anything before this day. Six months is the practical floor. */
  since?: string;
  today?: string;
  /** Descriptions already tracked as subscriptions, so they aren't re-suggested. */
  known?: string[];
}

export function detectRecurring(
  expenses: RecurringExpense[],
  { since, today = toDayKey(), known = [] }: DetectOptions = {}
): DetectedRecurring[] {
  const floor = since ?? toDayKey(addDays(fromDayKey(today), -400));
  const knownKeys = new Set(known.map(k => groupKey(normalizeDescription(k))).filter(Boolean));

  // Auto-posted charges are already known subscriptions — rediscovering them
  // would fill the list with things the person can already see.
  const candidates = new Map<string, Candidate>();

  for (const e of expenses) {
    if (e.source === 'subscription') continue;
    const description = (e.description ?? '').trim();
    if (!description) continue;

    const day = toDayKey(new Date(e.date));
    if (!isValidDayKey(day) || day < floor || day > today) continue;

    const normalized = normalizeDescription(description);
    const key = groupKey(normalized);
    if (!key || key.length < 3 || knownKeys.has(key)) continue;

    const candidate = candidates.get(key) ?? {
      key,
      label: description,
      category: e.category,
      entries: [],
    };
    candidate.entries.push({ day, amount: e.amount });
    candidates.set(key, candidate);
  }

  const found: DetectedRecurring[] = [];

  for (const candidate of candidates.values()) {
    const entries = candidate.entries.sort((a, b) => (a.day < b.day ? -1 : 1));
    if (entries.length < MIN_OCCURRENCES) continue;

    // Two charges on the same day are one charge recorded twice, or a split
    // payment — either way one occurrence for cadence purposes.
    const days = [...new Set(entries.map(e => e.day))];
    if (days.length < MIN_OCCURRENCES) continue;

    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) {
      gaps.push(daysApart(days[i - 1]!, days[i]!));
    }
    const medianGap = median(gaps);
    if (medianGap < HABIT_GAP_DAYS) continue; // a daily habit, not a subscription

    const cadence = CADENCES.find(c => Math.abs(medianGap - c.days) <= c.tolerance);
    if (!cadence) continue;

    // How many gaps actually land on the cadence. This is the periodicity
    // signal: three charges a month apart score 1, three scattered charges that
    // happen to average a month score much lower.
    const onCadence = gaps.filter(g => Math.abs(g - cadence.days) <= cadence.tolerance).length;
    const regularity = gaps.length > 0 ? onCadence / gaps.length : 0;

    const amounts = entries.map(e => e.amount);
    const typical = median(amounts);
    if (typical <= 0) continue;

    // Consistent pricing is most of what separates a subscription from a shop
    // someone happens to visit monthly, so it is a gate rather than one weight
    // among four. Without the floor, a fortnightly Amazon habit whose amounts
    // span twenty-fold scores well on rhythm alone and gets offered as a
    // subscription — which is a suggestion to go and cancel something that does
    // not exist.
    const withinPrice = amounts.filter(a => Math.abs(a - typical) / typical <= 0.15).length;
    const amountStability = withinPrice / amounts.length;
    if (amountStability < MIN_AMOUNT_STABILITY) continue;

    // Occurrences seen against occurrences the span implies. Below 1 means
    // charges are missing from the middle, which is what a cancelled-and-resumed
    // service looks like.
    const span = daysApart(days[0]!, days[days.length - 1]!);
    const coverage = clamp(days.length / (span / cadence.days + 1), 0, 1);

    const confidence =
      0.35 * coverage +
      0.3 * regularity +
      0.2 * amountStability +
      0.15 * Math.min(days.length / 6, 1);

    if (confidence < 0.55) continue;

    const lastSeen = days[days.length - 1]!;
    const latestAmount = entries.filter(e => e.day === lastSeen).reduce((s, e) => s + e.amount, 0);

    // The trailing median excludes the latest charge, so a price rise is
    // measured against what it used to cost rather than against itself.
    const priorAmounts = entries.filter(e => e.day !== lastSeen).map(e => e.amount);
    const priorTypical = priorAmounts.length >= 2 ? median(priorAmounts) : typical;
    const rise = priorTypical > 0 ? (latestAmount - priorTypical) / priorTypical : 0;

    found.push({
      key: candidate.key,
      label: candidate.label,
      category: candidate.category,
      amount: typical,
      latestAmount,
      frequency: cadence.frequency,
      medianGap,
      occurrences: days.length,
      firstSeen: days[0]!,
      lastSeen,
      nextExpected: toDayKey(addDays(fromDayKey(lastSeen), Math.round(medianGap))),
      annualCost: toAnnualCost({ amount: latestAmount, frequency: cadence.frequency }),
      confidence,
      priceIncrease:
        rise > 0.1
          ? { from: priorTypical, to: latestAmount, percent: rise * 100 }
          : null,
    });
  }

  // Ranked by money, not by confidence: a near-certain ₹99 charge matters less
  // than a probable ₹4,000 one.
  return found.sort((a, b) => b.annualCost - a.annualCost);
}

// ── Health checks on subscriptions that ARE tracked ──────────────────────────

export interface SubscriptionHealth {
  subscriptionId: string | null;
  name: string;
  /** Days since the last charge posted against it. Null when never charged. */
  daysSinceCharge: number | null;
  /** Nothing has posted for well over a cycle — worth asking whether it's live. */
  dormant: boolean;
  /** The last charge came in above the price on record. */
  priceDrift: { recorded: number; charged: number; percent: number } | null;
  annualCost: number;
}

/**
 * Checks tracked subscriptions against what has actually been charged.
 *
 * The two things this catches are the two things that cost real money and go
 * unnoticed: a subscription that has quietly stopped posting (cancelled at the
 * provider, still in the budget, still reserving money every month) and one
 * whose price rose without anyone updating the record — after which every
 * forecast and every budget line built on it is wrong in the same direction.
 */
export function subscriptionHealth(
  subscriptions: { _id: string; name: string; amount: number; frequency: Frequency }[],
  expenses: RecurringExpense[],
  today: string = toDayKey()
): SubscriptionHealth[] {
  const normalize = (v: string | undefined) => (v ?? '').trim().toLowerCase();

  return subscriptions.map(sub => {
    const charges = expenses
      .filter(e => e.source === 'subscription' && normalize(e.description) === normalize(sub.name))
      .map(e => ({ day: toDayKey(new Date(e.date)), amount: e.amount }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));

    const latest = charges[0] ?? null;
    const daysSinceCharge = latest ? daysApart(latest.day, today) : null;

    const cycleDays =
      sub.frequency === 'daily' ? 1 : sub.frequency === 'weekly' ? 7 : sub.frequency === 'monthly' ? 30.4 : 365;

    const drift =
      latest && sub.amount > 0 ? (latest.amount - sub.amount) / sub.amount : 0;

    return {
      subscriptionId: sub._id,
      name: sub.name,
      daysSinceCharge,
      // One and a half cycles. A whole cycle is too tight — a charge that lands
      // a couple of days late would flag every healthy subscription.
      dormant: daysSinceCharge !== null && daysSinceCharge > cycleDays * 1.5,
      priceDrift:
        Math.abs(drift) > 0.05 && latest
          ? { recorded: sub.amount, charged: latest.amount, percent: drift * 100 }
          : null,
      annualCost: toAnnualCost(sub),
    };
  });
}

/** Whole days between two `YYYY-MM-DD` keys. */
function daysApart(from: string, to: string): number {
  return Math.round(
    (fromDayKey(to).getTime() - fromDayKey(from).getTime()) / 86_400_000
  );
}

/** What the tracked subscriptions cost over a year, for the headline figure. */
export const annualBurn = (
  subscriptions: { amount: number; frequency: Frequency }[]
): number => subscriptions.reduce((total, s) => total + toAnnualCost(s), 0);

/** Average of a set of numbers, re-exported so callers need one import. */
export { mean };
