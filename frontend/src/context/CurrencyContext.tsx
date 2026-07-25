import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  isCurrency,
  readCachedCurrency,
  writeCachedCurrency,
  type Currency,
} from '@/lib/currencyCache';

export type { Currency };

interface CurrencyContextType {
  currency: Currency;
  /** Persists to the account. Rejects (and reverts) if the save fails. */
  setCurrency: (c: Currency) => Promise<void>;
  formatAmount: (amount: number) => string;
  currencySymbol: string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(readCachedCurrency);

  // Pull the stored preference for this account. This is what makes a fresh
  // browser or a second device show the right currency without being told.
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
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

  const setCurrency = async (next: Currency) => {
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
  };

  const currencySymbol = currency === 'INR' ? '₹' : '$';

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatAmount, currencySymbol }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
