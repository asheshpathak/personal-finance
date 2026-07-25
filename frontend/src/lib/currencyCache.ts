export type Currency = 'USD' | 'INR';

export const CURRENCIES: Currency[] = ['USD', 'INR'];

export const isCurrency = (value: unknown): value is Currency =>
  CURRENCIES.includes(value as Currency);

/**
 * Local copy of the account's currency preference.
 *
 * This is a first-paint cache, not storage: without it every load would flash
 * the default symbol while the account is fetched. The server owns the value
 * and overwrites this on each load.
 */
const CACHE_KEY = 'currency';

export function readCachedCurrency(): Currency {
  const stored = localStorage.getItem(CACHE_KEY);
  return isCurrency(stored) ? stored : 'USD';
}

export function writeCachedCurrency(currency: Currency) {
  localStorage.setItem(CACHE_KEY, currency);
}

/** Called on logout so the next account on this device doesn't inherit it. */
export function clearCachedCurrency() {
  localStorage.removeItem(CACHE_KEY);
}
