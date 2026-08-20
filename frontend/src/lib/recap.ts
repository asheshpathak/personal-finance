import { median, quantile } from './robust';
import { addDays, formatDay, fromDayKey, isValidDayKey, MONTH_NAMES, toDayKey } from './dates';
import { categoryGroup } from './expenseCategories';
import { buildRhythm } from './rhythm';

/**
 * The month in review.
 *
 * This exists because an expense tracker is a chore with no payoff, and a
 * period boundary is the one moment when someone is willing to look back. The
 * pattern is Spotify Wrapped's, and so are the rules that make it work rather
 * than feel like a report:
 *
 *  · **One claim per slide.** A slide with two facts has none.
 *  · **Frequency beats amount.** "Your most-visited" is identity; "where you
 *    burned the most cash" is an accusation. Both are in the data; only one is
 *    something a person wants to see.
 *  · **Relative framing, always available.** Absolute amounts are private and
 *    unshareable. Every slide that can express itself as a share, a rank or a
 *    count does, so hiding the figures leaves something worth reading.
 *  · **Suppress on thin data.** A recap over nine payments is embarrassing. It
 *    is better to say "not this month" than to pad.
 *
 * Monthly rather than yearly on purpose: a yearly recap is one feedback loop a
 * year, and twelve is worth more than one.
 */

export interface RecapExpense {
  _id?: string;
  amount: number;
  category: string;
  description?: string;
  paymentMode?: string;
  date: string;
  source?: 'manual' | 'subscription';
}

export type SlideKind =
  | 'opening'
  | 'total'
  | 'top-category'
  | 'most-visited'
  | 'biggest'
  | 'rhythm'
  | 'no-spend'
  | 'shift'
  | 'subscriptions'
  | 'closing';

export interface RecapSlide {
  kind: SlideKind;
  /** Small line above the headline. */
  eyebrow: string;
  /** The claim. Short — this is set large. */
  headline: string;
  /** The figure, when there is one. Already formatted. */
  value?: string;
  /** One supporting sentence. */
  detail: string;
  /** A version of `detail` with no absolute amounts, for sharing. */
  shareable: string;
  /** Accent slot 0–5, so consecutive slides don't repeat a hue. */
  accent: number;
}

export interface Recap {
  /** `YYYY-MM` the recap covers. */
  month: string;
  label: string;
  slides: RecapSlide[];
  /** Fewer than this many payments and there is nothing worth showing. */
  eligible: boolean;
  totals: {
    spent: number;
    payments: number;
    categories: number;
    /** Change against the previous month, as a fraction. Null with no baseline. */
    change: number | null;
  };
}

/** Below this the recap is suppressed rather than padded. */
const MIN_PAYMENTS = 12;

const monthKeyOf = (day: string) => day.slice(0, 7);

function monthLabel(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? ''} ${y}`;
}

/** Ordinal-ish share phrasing that reads as a fact rather than a judgement. */
function shareWord(share: number): string {
  if (share >= 0.5) return 'more than half';
  if (share >= 0.33) return 'a third';
  if (share >= 0.25) return 'a quarter';
  if (share >= 0.2) return 'a fifth';
  return `${Math.round(share * 100)}%`;
}

export interface RecapOptions {
  /** `YYYY-MM`. Defaults to the last complete month. */
  month?: string;
  money: (value: number) => string;
  today?: string;
}

export function buildRecap(expenses: RecapExpense[], { month, money, today = toDayKey() }: RecapOptions): Recap {
  const now = isValidDayKey(today) ? fromDayKey(today) : new Date();
  // The default is the *previous* month: the current one is incomplete, and a
  // recap of a half-finished month compares badly against a full one.
  const target = month ?? monthKeyOf(toDayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const previous = monthKeyOf(
    toDayKey(new Date(Number(target.slice(0, 4)), Number(target.slice(5, 7)) - 2, 1))
  );

  const inMonth = expenses.filter(e => monthKeyOf(toDayKey(new Date(e.date))) === target);
  const inPrevious = expenses.filter(e => monthKeyOf(toDayKey(new Date(e.date))) === previous);

  const spent = inMonth.reduce((total, e) => total + e.amount, 0);
  const previousSpent = inPrevious.reduce((total, e) => total + e.amount, 0);
  const change = previousSpent > 0 ? (spent - previousSpent) / previousSpent : null;

  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const e of inMonth) {
    const entry = byCategory.get(e.category) ?? { amount: 0, count: 0 };
    entry.amount += e.amount;
    entry.count += 1;
    byCategory.set(e.category, entry);
  }

  const totals = {
    spent,
    payments: inMonth.length,
    categories: byCategory.size,
    change,
  };

  if (inMonth.length < MIN_PAYMENTS) {
    return { month: target, label: monthLabel(target), slides: [], eligible: false, totals };
  }

  const slides: RecapSlide[] = [];
  let accent = 0;
  const push = (slide: Omit<RecapSlide, 'accent'>) => {
    slides.push({ ...slide, accent: accent % 6 });
    accent += 1;
  };

  // ── Opening ───────────────────────────────────────────────────────────────
  const days = new Set(inMonth.map(e => toDayKey(new Date(e.date)))).size;
  push({
    kind: 'opening',
    eyebrow: monthLabel(target),
    headline: 'Your month, counted',
    detail: `${inMonth.length} payments across ${days} days and ${byCategory.size} categories.`,
    shareable: `${inMonth.length} payments across ${days} days and ${byCategory.size} categories.`,
  });

  // ── The total, framed against last month ──────────────────────────────────
  if (change !== null) {
    const up = change > 0;
    const magnitude = Math.abs(Math.round(change * 100));
    push({
      kind: 'total',
      eyebrow: 'Against last month',
      headline: magnitude < 3 ? 'Almost exactly the same' : up ? `${magnitude}% more` : `${magnitude}% less`,
      value: money(spent),
      detail: `${money(spent)} this month against ${money(previousSpent)} in ${monthLabel(previous)}.`,
      shareable:
        magnitude < 3
          ? `Spending landed within 3% of the month before.`
          : `Spending was ${magnitude}% ${up ? 'higher' : 'lower'} than the month before.`,
    });
  } else {
    push({
      kind: 'total',
      eyebrow: 'Total',
      headline: 'The whole month',
      value: money(spent),
      detail: `Across ${inMonth.length} payments.`,
      shareable: `${inMonth.length} payments recorded.`,
    });
  }

  // ── The biggest category, by money ────────────────────────────────────────
  const ranked = [...byCategory.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const top = ranked[0];
  if (top) {
    const share = spent > 0 ? top[1].amount / spent : 0;
    push({
      kind: 'top-category',
      eyebrow: 'Where it went',
      headline: top[0],
      value: money(top[1].amount),
      detail: `${shareWord(share)} of everything you spent, over ${top[1].count} payments.`,
      shareable: `${top[0]} took ${shareWord(share)} of the month, over ${top[1].count} payments.`,
    });
  }

  // ── The most-visited place, by frequency ──────────────────────────────────
  //
  // Ranked by count rather than amount, deliberately: this is the slide people
  // recognise themselves in, and "where you went most" is a nicer mirror than
  // "where you spent most".
  const byMerchant = new Map<string, { amount: number; count: number; label: string }>();
  for (const e of inMonth) {
    const raw = (e.description ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const entry = byMerchant.get(key) ?? { amount: 0, count: 0, label: raw };
    entry.amount += e.amount;
    entry.count += 1;
    byMerchant.set(key, entry);
  }
  const visited = [...byMerchant.values()].sort((a, b) => b.count - a.count)[0];
  if (visited && visited.count >= 3) {
    push({
      kind: 'most-visited',
      eyebrow: 'Your regular',
      headline: visited.label,
      value: `${visited.count}×`,
      detail: `${visited.count} visits, ${money(visited.amount)} in total.`,
      shareable: `${visited.count} visits — the thing you came back to most.`,
    });
  }

  // ── The single biggest payment ────────────────────────────────────────────
  const biggest = [...inMonth].sort((a, b) => b.amount - a.amount)[0];
  if (biggest) {
    const typical = median(inMonth.map(e => e.amount));
    const multiple = typical > 0 ? biggest.amount / typical : 0;
    push({
      kind: 'biggest',
      eyebrow: 'The big one',
      headline: biggest.description || biggest.category,
      value: money(biggest.amount),
      detail: `${formatDay(new Date(biggest.date))} · ${multiple >= 2 ? `${multiple.toFixed(0)}× a typical payment` : 'your largest this month'}.`,
      shareable:
        multiple >= 2
          ? `The largest single payment was ${multiple.toFixed(0)}× a typical one.`
          : 'One payment stood above the rest.',
    });
  }

  // ── Rhythm ────────────────────────────────────────────────────────────────
  const rhythm = buildRhythm(inMonth, { days: 40, today });
  const busiest = [...rhythm.byWeekday].sort((a, b) => b.average - a.average)[0];
  if (busiest && busiest.average > 0) {
    push({
      kind: 'rhythm',
      eyebrow: 'Your rhythm',
      headline: `${busiest.label}s cost the most`,
      value: money(busiest.average),
      detail: `On an average ${busiest.label}, against ${money(spent / Math.max(days, 1))} on an average day.`,
      shareable: `${busiest.label}s were consistently the most expensive day of the week.`,
    });
  }

  // ── No-spend days ─────────────────────────────────────────────────────────
  if (rhythm.noSpendDays > 0) {
    push({
      kind: 'no-spend',
      eyebrow: 'Days you spent nothing',
      headline: `${rhythm.noSpendDays} quiet days`,
      value: String(rhythm.noSpendDays),
      detail:
        rhythm.longestStreak > 1
          ? `Your longest logging run was ${rhythm.longestStreak} days.`
          : 'Days with no payment recorded at all.',
      shareable: `${rhythm.noSpendDays} days without spending anything.`,
    });
  }

  // ── The biggest shift against last month ──────────────────────────────────
  if (inPrevious.length > 0) {
    const previousByCategory = new Map<string, number>();
    for (const e of inPrevious) {
      previousByCategory.set(e.category, (previousByCategory.get(e.category) ?? 0) + e.amount);
    }
    const shifts = [...byCategory.entries()]
      .map(([category, { amount }]) => ({
        category,
        delta: amount - (previousByCategory.get(category) ?? 0),
        previous: previousByCategory.get(category) ?? 0,
        amount,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const shift = shifts[0];
    // Only worth a slide when the move is meaningful against the whole month —
    // a category that doubled from ₹80 to ₹160 is not news.
    if (shift && Math.abs(shift.delta) > spent * 0.05) {
      const up = shift.delta > 0;
      const percent = shift.previous > 0 ? Math.abs(Math.round((shift.delta / shift.previous) * 100)) : null;
      push({
        kind: 'shift',
        eyebrow: 'The biggest change',
        headline: `${shift.category} ${up ? 'up' : 'down'}${percent !== null ? ` ${percent}%` : ''}`,
        value: money(Math.abs(shift.delta)),
        detail: `${money(shift.previous)} last month, ${money(shift.amount)} this one.`,
        shareable: `${shift.category} moved the most of any category${percent !== null ? `, ${up ? 'up' : 'down'} ${percent}%` : ''}.`,
      });
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const auto = inMonth.filter(e => e.source === 'subscription');
  if (auto.length > 0) {
    const autoTotal = auto.reduce((total, e) => total + e.amount, 0);
    const share = spent > 0 ? autoTotal / spent : 0;
    push({
      kind: 'subscriptions',
      eyebrow: 'Money that moved by itself',
      headline: `${auto.length} recurring ${auto.length === 1 ? 'charge' : 'charges'}`,
      value: money(autoTotal),
      detail: `${shareWord(share)} of the month went out without anyone deciding.`,
      shareable: `${shareWord(share)} of the month was recurring charges.`,
    });
  }

  // ── Closing ───────────────────────────────────────────────────────────────
  const groups = new Map<string, number>();
  for (const e of inMonth) {
    const group = categoryGroup(e.category);
    groups.set(group, (groups.get(group) ?? 0) + e.amount);
  }
  const putAway = (groups.get('savings') ?? 0) + (groups.get('investments') ?? 0);

  push({
    kind: 'closing',
    eyebrow: 'That was the month',
    headline: putAway > 0 ? `${money(putAway)} put to work` : 'On to the next one',
    detail:
      putAway > 0
        ? `Savings and investments together, ${Math.round((putAway / spent) * 100)}% of everything recorded.`
        : `${inMonth.length} payments recorded, ${byCategory.size} categories touched.`,
    shareable:
      putAway > 0
        ? `${Math.round((putAway / spent) * 100)}% of the month went into savings and investments.`
        : `${inMonth.length} payments, ${byCategory.size} categories.`,
  });

  return { month: target, label: monthLabel(target), slides, eligible: true, totals };
}

/**
 * The months there is enough data to recap, newest first.
 *
 * The current month is excluded — a recap of a month still being lived is a
 * comparison against nothing.
 */
export function recappableMonths(expenses: RecapExpense[], today: string = toDayKey()): string[] {
  const current = monthKeyOf(today);
  const counts = new Map<string, number>();
  for (const e of expenses) {
    const month = monthKeyOf(toDayKey(new Date(e.date)));
    if (month >= current) continue;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_PAYMENTS)
    .map(([month]) => month)
    .sort((a, b) => (a < b ? 1 : -1));
}

/** Re-exported so a caller charting the recap needs one import. */
export { quantile, addDays };
