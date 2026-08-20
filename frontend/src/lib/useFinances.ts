import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useDataRefresh } from '@/context/DataRefreshContext';
import type { Budget } from './budgetSections';
import type { ExpenseItem } from '@/components/ExpenseList';
import type { ScheduledSubscription } from './subscriptionSchedule';
import type { Frequency } from './subscriptionTotals';
import type { DayOfWeek, PendingSchedule } from './subscriptionDueDate';

/**
 * The three collections, loaded together.
 *
 * Almost every screen in this app needs at least two of expenses, budgets and
 * subscriptions, and the forecast needs all three — a projection built from
 * expenses alone treats known future charges as random noise, which is both
 * wrong and worse than doing nothing. Loading them as a set rather than per
 * page means one round of requests and, more importantly, one definition of
 * "the current data" that every derived figure on a screen agrees with.
 *
 * Deliberately not a query cache. Three endpoints, one user, a few hundred rows
 * — the machinery would exceed the problem.
 */

export interface SubscriptionRecord extends ScheduledSubscription {
  _id: string;
  category: string;
  paymentMode?: string;
  /** Derived by the server: the next day this will post an expense. */
  nextDueDay?: string | null;
  pendingSchedule?: PendingSchedule | null;
  pendingEffectiveFrom?: string | null;
  dueDayOfWeek?: DayOfWeek | null;
  frequency: Frequency;
}

export interface Finances {
  expenses: ExpenseItem[];
  budgets: Budget[];
  subscriptions: SubscriptionRecord[];
  /** The budget the dashboard measures against, or null. */
  activeBudget: Budget | null;
  loading: boolean;
  /** True once a first load has settled, successfully or not. */
  ready: boolean;
  error: string | null;
  reload: () => void;
}

export interface FinancesOptions {
  /** Skip collections a page doesn't need. All are loaded by default. */
  expenses?: boolean;
  budgets?: boolean;
  subscriptions?: boolean;
}

export function useFinances({
  expenses: wantExpenses = true,
  budgets: wantBudgets = true,
  subscriptions: wantSubscriptions = true,
}: FinancesOptions = {}): Finances {
  const { version, refresh } = useDataRefresh();

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Loading is *derived*, not stored.
   *
   * The obvious version sets a flag at the top of the effect, which means one
   * render where the new version has been requested but the flag still says
   * "settled" — and on a refresh that produces a visible flash of stale data
   * presented as current. Comparing the version we have against the version we
   * want is true on the render where it changes, with no extra state.
   */
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const loading = loadedVersion !== version;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [nextExpenses, nextBudgets, nextSubscriptions] = await Promise.all([
          wantExpenses ? api.get<ExpenseItem[]>('/api/expenses') : Promise.resolve([]),
          wantBudgets ? api.get<Budget[]>('/api/budgets') : Promise.resolve([]),
          wantSubscriptions
            ? api.get<SubscriptionRecord[]>('/api/subscriptions')
            : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setExpenses(nextExpenses);
        setBudgets(nextBudgets);
        setSubscriptions(nextSubscriptions);
        setError(null);
      } catch (err) {
        console.error(err);
        // A 401 has already torn the session down through the api client's own
        // signal, so anything reaching here is a real failure worth naming.
        if (!cancelled) setError("Couldn't load your data. Check your connection.");
      } finally {
        if (!cancelled) {
          setLoadedVersion(version);
          setReady(true);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
    // `version` is the refresh signal: any write anywhere in the app bumps it.
  }, [version, wantExpenses, wantBudgets, wantSubscriptions]);

  const activeBudget = useMemo(() => budgets.find(b => b.isActive) ?? null, [budgets]);

  return {
    expenses,
    budgets,
    subscriptions,
    activeBudget,
    loading,
    ready,
    error,
    reload: refresh,
  };
}
