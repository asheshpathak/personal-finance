import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Plus, Receipt, Sparkles } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { EmptyState, SectionHeader, Skeleton } from '@/components/ui/section';
import { Badge } from '@/components/ui/badge';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { ExpenseList, byRecency, type ExpenseItem } from '@/components/ExpenseList';
import { ExpenseEditDialog } from '@/components/ExpenseEditDialog';
import { SafeToSpend } from '@/components/home/SafeToSpend';
import { RhythmCard } from '@/components/home/RhythmCard';
import { BriefCard } from '@/components/BriefCard';
import { useCurrency } from '@/context/CurrencyContext';
import { useQuickAdd } from '@/context/QuickAddContext';
import { useFinances } from '@/lib/useFinances';
import { api } from '@/lib/api';
import { computeBudgetUtilization } from '@/lib/budgetSections';
import { projectPeriod } from '@/lib/forecast';
import { buildRhythm } from '@/lib/rhythm';
import { findAnomalies } from '@/lib/anomaly';
import { formatDay, fromDayKey, startOfMonth, endOfMonth, toDayKey } from '@/lib/dates';

/**
 * Home.
 *
 * The order of this page is an argument. A dashboard that opens with a wall of
 * charts has no verb in it — the reader has to decide what to do with the
 * information, every single time. So the first thing on screen is a *decision*
 * ("how much can I spend today"), the second is *judgement* ("here is what
 * stands out"), and only then does it become *record* — what happened, and
 * what is coming.
 */
export default function Dashboard() {
  const { formatMoney, formatRounded } = useCurrency();
  const { openQuickAdd } = useQuickAdd();
  const { expenses, subscriptions, activeBudget, loading, ready, error, reload } = useFinances();

  const [editing, setEditing] = useState<ExpenseItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const today = toDayKey();

  /**
   * The window everything on this page measures.
   *
   * The active budget's period when there is one — that is the frame the reader
   * has chosen. Otherwise the calendar month, which is the frame everyone
   * defaults to when they haven't chosen.
   */
  const period = useMemo(() => {
    if (activeBudget) {
      return {
        start: new Date(activeBudget.startDate).toISOString().slice(0, 10),
        end: new Date(activeBudget.endDate).toISOString().slice(0, 10),
      };
    }
    const now = fromDayKey(today);
    return { start: toDayKey(startOfMonth(now)), end: toDayKey(endOfMonth(now)) };
  }, [activeBudget, today]);

  const utilization = useMemo(
    () => (activeBudget ? computeBudgetUtilization(activeBudget, expenses) : null),
    [activeBudget, expenses]
  );

  const projection = useMemo(
    () =>
      projectPeriod({
        expenses,
        subscriptions,
        startDay: period.start,
        endDay: period.end,
        today,
        ...(utilization ? { planned: utilization.totals.allocated } : {}),
        seed: activeBudget?._id ?? period.start,
      }),
    [expenses, subscriptions, period, today, utilization, activeBudget]
  );

  const rhythm = useMemo(() => buildRhythm(expenses, { today }), [expenses, today]);

  /**
   * Unusual payments, floored at 2% of the period's plan.
   *
   * The floor is what makes this bearable rather than noisy: a ₹300 outlier in
   * a coffee category is statistically extreme and humanly irrelevant, and an
   * interface that flags it twice loses the right to be believed the third time.
   */
  const anomalies = useMemo(
    () =>
      findAnomalies(expenses, {
        floor: (utilization?.totals.allocated ?? projection.expected) * 0.02,
        limit: 2,
        today,
      }),
    [expenses, utilization, projection.expected, today]
  );

  /** The next handful of scheduled charges, so nothing arrives as a surprise. */
  const upcoming = projection.upcoming.slice(0, 4);

  const recent = useMemo(() => [...expenses].sort(byRecency).slice(0, 8), [expenses]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const removeExpense = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/expenses/${deleteId}`);
      reload();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading && !ready) {
    return (
      <Layout title="Home">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  const empty = ready && expenses.length === 0;

  return (
    <Layout title="Home">
      <div className="flex flex-col gap-5 sm:gap-6 min-w-0">
        {/* ── Greeting ─────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="min-w-0">
            <h1 className="text-title-1 sm:text-display">{greeting}</h1>
            <p className="mt-1 text-subhead text-muted-foreground">
              {formatDay(new Date(), { weekday: 'long', year: undefined })}
              {activeBudget && (
                <>
                  {' · '}
                  {formatDay(fromDayKey(period.start), { year: undefined })} –{' '}
                  {formatDay(fromDayKey(period.end))}
                </>
              )}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-destructive-tint px-4 py-3 text-footnote text-destructive-text">
            {error}
          </p>
        )}

        {empty ? (
          <EmptyState
            icon={Receipt}
            title="Nothing recorded yet"
            body="Record one payment and this page starts working — a daily allowance, a projection, and where the money actually goes."
            action={
              <Button size="lg" onClick={() => openQuickAdd()}>
                <Plus strokeWidth={2.5} />
                Record your first payment
              </Button>
            }
          />
        ) : (
          <>
            {/* ── The number ───────────────────────────────────────────── */}
            <SafeToSpend
              projection={projection}
              planned={utilization ? utilization.totals.allocated : null}
            />

            {/* ── Anything unusual ─────────────────────────────────────── */}
            {anomalies.length > 0 && (
              <div className="flex flex-col gap-2">
                {anomalies.map(anomaly => (
                  <div
                    key={anomaly.id}
                    className="flex items-center gap-3 rounded-xl border border-warning-border bg-warning-tint px-4 py-3 min-w-0"
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning-text">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <p className="min-w-0 flex-1 text-footnote">
                      <span className="font-semibold">
                        {anomaly.expense.description || anomaly.expense.category}
                      </span>{' '}
                      <span className="text-muted-foreground">— {anomaly.reason}</span>
                    </p>
                    <span className="flex-shrink-0 text-subhead font-bold tnum text-warning-text">
                      {formatRounded(anomaly.expense.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ── The judgement ────────────────────────────────────────── */}
            <BriefCard />

            {/* ── Where it is going, this period ───────────────────────── */}
            {utilization && utilization.sections.some(s => s.items.length > 0) && (
              <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
                <SectionHeader
                  title="This period"
                  subtitle={
                    <span className="tnum">
                      {formatRounded(utilization.totals.spent)} of{' '}
                      {formatRounded(utilization.totals.allocated)} planned
                    </span>
                  }
                  to="/plan"
                  actionLabel="Forecast"
                />

                <ul className="mt-4 divide-y divide-border">
                  {utilization.sections
                    .flatMap(section => section.items.map(item => ({ ...item, section: section.key })))
                    .sort((a, b) => b.spent - a.spent)
                    .slice(0, 5)
                    .map(item => (
                      <li key={`${item.section}-${item.category}`} className="py-3 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 flex-1 truncate text-subhead font-medium">
                            {item.category}
                          </span>
                          <span className="flex-shrink-0 text-subhead tnum">
                            {formatRounded(item.spent)}
                          </span>
                          <span
                            className={`w-12 flex-shrink-0 text-right text-footnote font-semibold tnum ${
                              item.rawPercentage > 100 ? 'text-destructive-text' : 'text-muted-foreground'
                            }`}
                          >
                            {Math.round(item.rawPercentage)}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-[width] duration-700 ease-spring"
                            style={{
                              width: `${Math.max(Math.min(item.percentage, 100), item.spent > 0 ? 2 : 0)}%`,
                              // One measure, one hue. A per-category colour
                              // here means a line at 100% can render in the
                              // palette's coral and read as an error when it is
                              // exactly on plan.
                              backgroundColor:
                                item.rawPercentage > 100
                                  ? 'hsl(var(--destructive))'
                                  : 'hsl(var(--primary))',
                            }}
                          />
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            {/* ── What is coming ───────────────────────────────────────── */}
            {upcoming.length > 0 && (
              <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
                <SectionHeader
                  title="Coming up"
                  subtitle={
                    <span className="tnum">
                      {formatRounded(projection.committedRemaining)} before{' '}
                      {formatDay(fromDayKey(period.end), { year: undefined })}
                    </span>
                  }
                  to="/subscriptions"
                  actionLabel="All"
                />

                <ul className="mt-4 divide-y divide-border">
                  {upcoming.map(charge => (
                    <li
                      key={`${charge.subscriptionId ?? charge.name}-${charge.day}`}
                      className="flex items-center gap-3 py-2.5 min-w-0"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.65rem] bg-muted text-muted-foreground">
                        <CalendarClock className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-subhead font-medium">{charge.name}</span>
                        <span className="block text-caption text-muted-foreground">
                          {formatDay(fromDayKey(charge.day), { year: undefined })}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-subhead font-semibold tnum">
                        {formatMoney(charge.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── The habit ────────────────────────────────────────────── */}
            <RhythmCard rhythm={rhythm} />

            {/* ── Recent ───────────────────────────────────────────────── */}
            <section className="min-w-0">
              <SectionHeader
                title="Recent"
                subtitle={`${expenses.length} payments recorded`}
                to="/expenses"
              />
              <div className="mt-3 rounded-2xl border border-border bg-card shadow-card px-4 py-3 sm:px-5">
                <ExpenseList expenses={recent} today={today} onOpen={setEditing} />
              </div>
            </section>

            <div className="flex justify-center pt-1">
              <Button variant="ghost" asChild>
                <Link to="/expenses">
                  See all activity
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </>
        )}
      </div>

      <ExpenseEditDialog
        expense={editing}
        onOpenChange={open => { if (!open) setEditing(null); }}
        onSaved={reload}
        onDelete={setDeleteId}
      />

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete this payment?"
        description="It will be removed permanently, and every total that includes it will change."
        onConfirm={removeExpense}
      />
    </Layout>
  );
}

export { Badge };
