import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, CheckCircle2, Circle, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/section';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useCurrency } from '@/context/CurrencyContext';
import { useFinances } from '@/lib/useFinances';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { computeBudgetUtilization, nonEmptySections, SECTION_META, type Budget } from '@/lib/budgetSections';
import { budgetLabel } from '@/lib/snapshots';
import { colorForName } from '@/lib/chartTheme';

/** One hue per section, so a colour means the same thing on every screen. */
const SECTION_COLOR: Record<string, string> = {
  expenses: 'hsl(var(--chart-1))',
  investments: 'hsl(var(--chart-5))',
  savings: 'hsl(var(--chart-3))',
  subscriptions: 'hsl(var(--chart-4))',
};

export default function Budgets() {
  const { formatRounded } = useCurrency();
  const { budgets, loading, ready, reload } = useFinances({ expenses: false, subscriptions: false });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const setActive = async (budget: Budget) => {
    try {
      await api.put(`/api/budgets/${budget._id}`, { ...budget, isActive: true });
      reload();
    } catch (err) {
      console.error(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/budgets/${deleteId}`);
      reload();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading && !ready) {
    return (
      <Layout title="Budgets">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-48" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Budgets">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Budgets"
          lede="Spending, investments, savings and subscriptions — planned section by section."
          action={
            <Button asChild>
              <Link to="/budgets/new">
                <Plus strokeWidth={2.5} />
                New budget
              </Link>
            </Button>
          }
        />

        {budgets.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No budget yet"
            body="A budget is what turns a running total into a daily allowance, and what the forecast measures against. Start from your own history — it will fill most of it in."
            action={
              <Button size="lg" asChild>
                <Link to="/budgets/new">
                  <Plus strokeWidth={2.5} />
                  Plan a period
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {budgets.map(budget => {
              // No expenses passed: this page plans, the dashboard tracks.
              const { sections, totals } = computeBudgetUtilization(budget, []);
              const funded = nonEmptySections(sections);

              return (
                <article
                  key={budget._id}
                  className={cn(
                    'flex flex-col rounded-2xl border bg-card p-5 shadow-card min-w-0',
                    budget.isActive ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/budgets/${budget._id}`}
                        // -m-2 p-2 lifts a 22px line of text to a 44px target
                        // without changing where anything sits.
                        className="tactile -m-2 flex min-w-0 items-center gap-2 rounded-lg p-2 hover:bg-subtle"
                      >
                        <Calendar className="h-4 w-4 flex-shrink-0 text-faint" />
                        <span className="truncate text-headline">{budgetLabel(budget)}</span>
                      </Link>
                      <div className="mt-2">
                        {budget.isActive ? (
                          <Badge tone="primary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Active
                          </Badge>
                        ) : (
                          <Badge tone="neutral" className="gap-1">
                            <Circle className="h-3 w-3" />
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="-mr-2 -mt-1 flex flex-shrink-0 gap-0.5">
                      <Button variant="ghost" size="icon-sm" asChild>
                        <Link to={`/budgets/${budget._id}/edit`} aria-label="Edit budget">
                          <Pencil />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-faint hover:bg-destructive-tint hover:text-destructive-text"
                        onClick={() => setDeleteId(budget._id)}
                        aria-label="Delete budget"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="text-overline uppercase text-faint">Allocated</p>
                    <p className="mt-1 text-title-1 tnum">{formatRounded(totals.allocated)}</p>
                  </div>

                  {/* How the plan splits, at a glance. Gaps rather than borders
                      between segments — a border on a 3px bar is most of the bar. */}
                  {totals.allocated > 0 && (
                    <div className="mt-4 flex h-2 w-full gap-[2px]" aria-hidden="true">
                      {funded.map(section => (
                        <div
                          key={section.key}
                          className="h-full first:rounded-l-full last:rounded-r-full"
                          style={{
                            width: `${(section.allocated / totals.allocated) * 100}%`,
                            backgroundColor: SECTION_COLOR[section.key] ?? colorForName(section.key),
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <ul className="mt-4 flex-1 space-y-2.5">
                    {funded.length === 0 ? (
                      <li className="text-subhead text-muted-foreground">Nothing allocated yet.</li>
                    ) : (
                      funded.map(section => (
                        <li key={section.key} className="min-w-0">
                          <div className="flex items-baseline justify-between gap-3 text-subhead">
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: SECTION_COLOR[section.key] }}
                              />
                              <span className="truncate">{SECTION_META[section.key].label}</span>
                            </span>
                            <span className="flex-shrink-0 font-semibold tnum">
                              {formatRounded(section.allocated)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate pl-[1.125rem] text-caption text-muted-foreground">
                            {section.items.map(i => i.category).join(', ')}
                          </p>
                        </li>
                      ))
                    )}
                  </ul>

                  {totals.income > 0 && (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-subhead">
                      <span className="text-muted-foreground">
                        {totals.unallocated < 0 ? 'Over income by' : 'Unallocated'}
                      </span>
                      <span
                        className={cn(
                          'font-semibold tnum',
                          totals.unallocated < 0 && 'text-destructive-text'
                        )}
                      >
                        {formatRounded(Math.abs(totals.unallocated))}
                      </span>
                    </div>
                  )}

                  {!budget.isActive && (
                    <Button
                      variant="outline"
                      className="mt-4 w-full"
                      onClick={() => void setActive(budget)}
                    >
                      Set as active
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete this budget?"
        description="The plan and all its allocations go. Payments recorded during its period are untouched."
        onConfirm={confirmDelete}
      />
    </Layout>
  );
}
