import type { Currency } from './currencyCache';

/**
 * Formatting money.
 *
 * One finding drives this whole file: **the locale, not the currency, decides
 * the digit grouping.** `Intl.NumberFormat('en-IN', {currency: 'USD'})` will
 * cheerfully render a dollar figure in lakhs — `$12.3L` — which is a real bug
 * waiting in any app that picks a locale from the user and a currency from the
 * account. So the locale is derived *from the currency*, always.
 *
 * The corollary is a nice one: `en-IN` already speaks Indian natively. Compact
 * notation emits `₹1.2L` and `₹1.2Cr` on its own, and standard notation groups
 * as `₹1,23,45,678`. There is no lakh/crore arithmetic to write, and any that
 * exists in a codebase is a bug that has not been noticed yet.
 */

const LOCALE: Record<Currency, string> = {
  INR: 'en-IN',
  USD: 'en-US',
};

const cache = new Map<string, Intl.NumberFormat>();

function formatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  // Constructing an Intl.NumberFormat is genuinely expensive — enough that
  // doing it per row in a five-hundred-row table is visible. They are immutable,
  // so caching them is free.
  let cached = cache.get(key);
  if (!cached) {
    cached = build();
    cache.set(key, cached);
  }
  return cached;
}

/** The ledger figure: exact, two decimals, for anything a person could check. */
export function exact(value: number, currency: Currency): string {
  return formatter(`exact:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  ).format(value);
}

/**
 * The scanning figure: decimals only when they say something.
 *
 * A list of forty payments reading "₹4,786.00" spends four characters per row
 * on nothing, and the eye has to skip them to compare magnitudes. Dropping them
 * unconditionally would be a lie about ₹4,786.50, so they appear exactly when
 * they carry information. This is the right default for rows, chips and
 * headers; `exact` stays for anything a person might reconcile against a
 * statement.
 */
export function smart(value: number, currency: Currency): string {
  // Rounded to the minor unit first: floating-point residue like 4786.000000001
  // would otherwise switch a whole figure into decimal form at random.
  const minor = Math.round(value * 100);
  return minor % 100 === 0 ? rounded(value, currency) : exact(value, currency);
}

/**
 * The summary figure: no decimals.
 *
 * Nobody budgets to the paisa, and a stat tile reading ₹18,432.00 spends four
 * characters saying nothing. Decimals belong in ledgers and editable fields,
 * where truncation would erode trust — and nowhere else.
 */
export function rounded(value: number, currency: Currency): string {
  return formatter(`rounded:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  ).format(value);
}

/**
 * The axis-label figure: `₹1.2L`, `$12.3K`.
 *
 * `minimumFractionDigits: 0` is doing real work here. Without it compact
 * notation renders a small integer as `₹7.0`, which looks like a bug because
 * it is one.
 */
export function compact(value: number, currency: Currency): string {
  return formatter(`compact:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      style: 'currency',
      currency,
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })
  ).format(value);
}

/** A signed change. The sign is always shown, including for zero-crossings. */
export function delta(value: number, currency: Currency): string {
  return formatter(`delta:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      style: 'currency',
      currency,
      signDisplay: 'exceptZero',
      maximumFractionDigits: 0,
    })
  ).format(value);
}

/** A signed percentage. Takes a fraction, not a percentage. */
export function percent(fraction: number, currency: Currency = 'USD'): string {
  return formatter(`percent:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      style: 'percent',
      signDisplay: 'exceptZero',
      maximumFractionDigits: 1,
    })
  ).format(fraction);
}

export const symbolFor = (currency: Currency): string => (currency === 'INR' ? '₹' : '$');

/**
 * Splits a figure into its symbol and its digits.
 *
 * So a hero balance can set the currency symbol smaller and lighter than the
 * number — the detail that separates a premium financial interface from a
 * `toLocaleString()` call, and it costs one API most people never reach for.
 */
export function parts(value: number, currency: Currency): { symbol: string; digits: string } {
  const formatted = formatter(`parts:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  ).formatToParts(value);

  let symbol = '';
  let digits = '';
  for (const part of formatted) {
    if (part.type === 'currency') symbol += part.value;
    else if (part.type === 'literal' && !symbol) symbol += part.value;
    else digits += part.value;
  }
  return { symbol, digits: digits.trim() };
}

// ── Minor units ─────────────────────────────────────────────────────────────

/**
 * The keypad's number model.
 *
 * An amount being typed is an *integer of minor units*, never a float being
 * parsed. Typing `1`, `.`, `0`, `5` and re-parsing the string on every keystroke
 * produces a value that is briefly `1`, then `1`, then `1.0`, then `1.05` — and
 * on the way it has been through `parseFloat("1.")`, which is a number nobody
 * asked for. Appending digits to an integer has none of these states.
 */
export const MINOR_UNITS = 100;

export const fromMinor = (minor: number): number => minor / MINOR_UNITS;
export const toMinor = (value: number): number => Math.round(value * MINOR_UNITS);

/** Appends one digit, bounded so a stuck key can't overflow the field. */
export function appendDigit(minor: number, digit: number): number {
  const next = minor * 10 + digit;
  // Ten crore is far past any plausible single payment and well inside a
  // double's exact-integer range.
  return next > 1_000_000_000_00 ? minor : next;
}

export const removeDigit = (minor: number): number => Math.floor(minor / 10);

/**
 * The half-typed amount, formatted for display.
 *
 * Shown without a currency symbol — the keypad puts the symbol beside it at its
 * own size, and letting `Intl` include one would make the two disagree.
 */
export function formatMinor(minor: number, currency: Currency): string {
  return formatter(`minor:${currency}`, () =>
    new Intl.NumberFormat(LOCALE[currency], {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  ).format(fromMinor(minor));
}
