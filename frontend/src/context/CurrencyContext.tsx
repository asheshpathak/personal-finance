import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken } from '@/lib/api';
import {
  isCurrency,
  readCachedCurrency,
  writeCachedCurrency,
  type Currency,
} from '@/lib/currencyCache';
import * as money from '@/lib/money';

export type { Currency };

interface CurrencyContextType {
  currency: Currency;
  /** Persists to the account. Rejects (and reverts) if the save fails. */
  setCurrency: (c: Currency) => Promise<void>;
  /** Exact, two decimals. For ledgers and anything a person could check. */
  formatAmount: (amount: number) => string;
  /** No decimals. For stat tiles, headlines and summaries. */
  formatRounded: (amount: number) => string;
  /** Decimals only when non-zero. The right default for list rows and chips. */
  formatMoney: (amount: number) => string;
  /** `₹1.2L` / `$12.3K`. For axis ticks and dense labels. */
  formatCompact: (amount: number) => string;
  /** Always signed. For a change against a baseline. */
  formatDelta: (amount: number) => string;
  /** Symbol and digits apart, so a hero figure can set them differently. */
  formatParts: (amount: number) => { symbol: string; digits: string };
  currencySymbol: string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(readCachedCurrency);

  // Pull the stored preference for this account. This is what makes a fresh
  // browser or a second device show the right currency without being told.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;

    api
      .get<{ currency: Currency | null }>('/api/auth/me')
      .then(user => {
        if (cancelled) return;

        if (isCurrency(user.currency)) {
          setCurrencyState(user.currency);
          writeCachedCurrency(user.currency);
          return;
        }

        // The account has never stored a currency — an account created before
        // this was a server-side preference. Adopt what this browser is
        // already set to and push it up, so nobody's existing choice is lost.
        api.put('/api/auth/preferences', { currency: readCachedCurrency() }).catch(console.error);
      })
      .catch(err => {
        // Offline or an expired token: keep showing the cached preference
        // rather than snapping every amount back to the default.
        console.error(err);
      });

    return () => { cancelled = true; };
  }, []);

  const setCurrency = useCallback(
    async (next: Currency) => {
      const previous = currency;
      // Optimistic: the whole app reformats immediately, and rolls back if the
      // account update doesn't land.
      setCurrencyState(next);
      writeCachedCurrency(next);

      try {
        await api.put('/api/auth/preferences', { currency: next });
      } catch (err) {
        setCurrencyState(previous);
        writeCachedCurrency(previous);
        throw err;
      }
    },
    [currency]
  );

  // Memoised on the currency alone. Every formatter below is referentially
  // stable across renders, which matters more than it looks: several pages pass
  // `formatAmount` into a `useMemo` dependency array, and a new function
  // identity every render would recompute an entire analytics pass per keystroke.
  const value = useMemo<CurrencyContextType>(
    () => ({
      currency,
      setCurrency,
      formatAmount: (amount: number) => money.exact(amount, currency),
      formatRounded: (amount: number) => money.rounded(amount, currency),
      formatMoney: (amount: number) => money.smart(amount, currency),
      formatCompact: (amount: number) => money.compact(amount, currency),
      formatDelta: (amount: number) => money.delta(amount, currency),
      formatParts: (amount: number) => money.parts(amount, currency),
      currencySymbol: money.symbolFor(currency),
    }),
    [currency, setCurrency]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
