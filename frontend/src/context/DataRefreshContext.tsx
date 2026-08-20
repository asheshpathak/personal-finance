import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * "Something changed — anyone showing expenses should look again."
 *
 * The quick-add sheet lives in the app shell, above every route, so it cannot
 * call the page's own `fetchExpenses`. Threading a callback down through the
 * layout would couple the shell to whatever happens to be routed underneath it.
 *
 * A version counter avoids both problems. The shell bumps it; every page has a
 * `useEffect` that depends on it. It is a hundredth of the machinery of a query
 * cache and does the one thing this app needs from one.
 */

interface DataRefreshValue {
  /** Increments whenever expenses, budgets or subscriptions change. */
  version: number;
  /** Call after any write. */
  refresh: () => void;
}

const DataRefreshContext = createContext<DataRefreshValue | undefined>(undefined);

export function DataRefreshProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const value = useMemo(() => ({ version, refresh }), [version, refresh]);

  return <DataRefreshContext.Provider value={value}>{children}</DataRefreshContext.Provider>;
}

export function useDataRefresh(): DataRefreshValue {
  const ctx = useContext(DataRefreshContext);
  // A default rather than a throw: a page rendered outside the shell — a test,
  // a storybook — should still work, just without cross-component refresh.
  return ctx ?? { version: 0, refresh: () => {} };
}
