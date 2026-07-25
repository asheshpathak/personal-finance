import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Calendar, CheckCircle2, Circle, Pencil, Wallet, TrendingUp, PiggyBank, Repeat } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { api } from '@/lib/api';
import {
  SECTION_META,
  computeBudgetUtilization,
  nonEmptySections,
  periodDays,
  type Budget,
  type SectionKey,
  type UtilizationSection,
} from '@/lib/budgetSections';

const SECTION_ICON: Record<SectionKey, LucideIcon> = {
  expenses: Wallet,
  investments: TrendingUp,
  savings: PiggyBank,
  subscriptions: Repeat,
};

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground truncate">
        {label}
      </p>
      <p className="mt-1.5 text-lg sm:text-2xl font-extrabold tracking-tight break-words">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}

/** One section's allocations, read-only. */
function SectionCard({
  section,
  totalAllocated,
  detailFor,
  formatAmount,
}: {
  section: UtilizationSection;
  totalAllocated: number;
  /** Extra line under a row's name, e.g. a subscription's price and cadence. */
  detailFor?: (name: string) => string | null;
  formatAmount: (value: number) => string;
}) {
  const Icon = SECTION_ICON[section.key];
  const meta = SECTION_META[section.key];

  return (
    <Card className="rounded-2xl border-2">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 18%, transparent)`, color: meta.color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">{section.label}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {section.items.length} {section.items.length === 1 ? 'line' : 'lines'} · {meta.blurb}
              </p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-base font-bold tabular-nums">{formatAmount(section.allocated)}</p>
            {totalAllocated > 0 && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {Math.round((section.allocated / totalAllocated) * 100)}% of budget
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="divide-y divide-white/[0.05]">
          {section.items.map(item => {
            const share = section.allocated > 0 ? (item.allocated / section.allocated) * 100 : 0;
            const detail = detailFor?.(item.category) ?? null;

            return (
              <div key={item.category} className="flex items-center gap-3 sm:gap-4 py-3.5">
                <span className="w-28 sm:w-52 flex-shrink-0 min-w-0">
                  <span className="block truncate text-sm font-medium">{item.category}</span>
                  {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
                </span>

                {/* Share of this section — one measure, so one hue. */}
                <div className="flex-1 min-w-0 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(share, 2)}%`, backgroundColor: meta.color }}
                  />
                </div>

                <span className="hidden sm:block flex-shrink-0 w-14 text-right text-xs text-muted-foreground tabular-nums">
                  {Math.round(share)}%
                </span>

                <span className="flex-shrink-0 w-24 sm:w-28 text-right text-sm font-bold tabular-nums">
                  {formatAmount(item.allocated)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BudgetViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatAmount } = useCurrency();

  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const budgets = await api.get<Budget[]>('/api/budgets');
        if (cancelled) return;
        const found = budgets.find(b => b._id === id);
        if (!found) {
          navigate('/budgets');
          return;
        }
        setBudget(found);
      } catch (err) {
        console.error(err);
        if (!cancelled) navigate('/budgets');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="py-12 text-center text-muted-foreground">Loading budget…</div>
      </Layout>
    );
  }

  if (!budget) return null;

  // No expenses passed: this page shows the plan, not what's been spent against
  // it — the dashboard is where utilization lives.
  const { sections, totals } = computeBudgetUtilization(budget, []);
  const funded = nonEmptySections(sections);
  const days = periodDays(budget.startDate, budget.endDate);

  const dateRange = `${new Date(budget.startDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(budget.endDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  // The row shows the prorated cost for this period; this says what the
  // subscription actually charges, which is what the reader recognises.
  const subscriptionDetail = (name: string) => {
    const sub = budget.subscriptions?.find(s => s.name === name);
    return sub ? `${formatAmount(sub.amount)} ${sub.frequency}` : null;
  };

  return (
    <Layout>
      <div className="flex flex-col gap-5 sm:gap-6 max-w-3xl">
        <div className="flex flex-col gap-4">
          <Button variant="ghost" className="w-fit -ml-2 text-muted-foreground hover:text-foreground" asChild>
            <Link to="/budgets">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Budgets
            </Link>
          </Button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tighter flex items-center gap-2.5">
                <Calendar className="w-6 h-6 text-muted-foreground flex-shrink-0" />
                <span className="truncate">{dateRange}</span>
              </h1>
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-background border">
                {budget.isActive ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                    <span className="text-primary">Active budget</span>
                  </>
                ) : (
                  <>
                    <Circle className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Inactive</span>
                  </>
                )}
              </div>
            </div>

            <Button variant="outline" className="flex-shrink-0 w-full sm:w-auto" asChild>
              <Link to={`/budgets/${budget._id}/edit`}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit budget
              </Link>
            </Button>
          </div>
        </div>

        {/* ── Overview ─────────────────────────────────────────────────── */}
        <Card className="rounded-2xl border-2">
          <CardContent className="p-5 sm:p-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              <Figure
                label="Allocated"
                value={formatAmount(totals.allocated)}
                hint={`across ${funded.length} ${funded.length === 1 ? 'section' : 'sections'}`}
              />
              <Figure label="Period" value={`${days} days`} hint={dateRange} />
              <Figure
                label="Income"
                value={totals.income > 0 ? formatAmount(totals.income) : '—'}
                hint={totals.income > 0 ? 'expected for this period' : 'not tracked'}
              />
              <Figure
                label={totals.unallocated < 0 ? 'Over income by' : 'Unallocated'}
                value={totals.income > 0 ? formatAmount(Math.abs(totals.unallocated)) : '—'}
                hint={totals.income > 0 ? 'income left to assign' : 'set an income to see this'}
              />
            </div>

            {/* How the plan splits, at a glance. */}
            {totals.allocated > 0 && (
              <>
                <div className="flex h-2 w-full gap-[2px] mt-6" aria-hidden="true">
                  {funded.map(section => (
                    <div
                      key={section.key}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      style={{
                        width: `${(section.allocated / totals.allocated) * 100}%`,
                        backgroundColor: section.color,
                      }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
                  {funded.map(section => (
                    <span key={section.key} className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: section.color }}
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground">{section.label}</span>
                      <span className="font-semibold tabular-nums">{formatAmount(section.allocated)}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Sections ─────────────────────────────────────────────────── */}
        {funded.length === 0 ? (
          <Card className="rounded-2xl p-10 text-center">
            <p className="font-semibold">Nothing allocated yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Edit this budget to plan your spending, investments and savings.
            </p>
          </Card>
        ) : (
          funded.map(section => (
            <SectionCard
              key={section.key}
              section={section}
              totalAllocated={totals.allocated}
              detailFor={section.key === 'subscriptions' ? subscriptionDetail : undefined}
              formatAmount={formatAmount}
            />
          ))
        )}
      </div>
    </Layout>
  );
}
