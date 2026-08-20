import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, PiggyBank, Repeat, TrendingUp, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Layout, BackLink } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { Stat, StatRow } from '@/components/ui/stat';
import { useCurrency } from '@/context/CurrencyContext';
import { api } from '@/lib/api';
import {
  computeBudgetUtilization,
  nonEmptySections,
  periodDays,
  SECTION_META,
  type Budget,
  type SectionKey,
  type UtilizationSection,
} from '@/lib/budgetSections';
import { budgetLabel } from '@/lib/snapshots';
import { colorForName } from '@/lib/chartTheme';

const SECTION_ICON: Record<SectionKey, LucideIcon> = {
  expenses: Wallet,
  investments: TrendingUp,
  savings: PiggyBank,
  subscriptions: Repeat,
};

const SECTION_COLOR: Record<SectionKey, string> = {
  expenses: 'hsl(var(--chart-1))',
  investments: 'hsl(var(--chart-5))',
  savings: 'hsl(var(--chart-3))',
  subscriptions: 'hsl(var(--chart-4))',
};

export default function BudgetViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatMoney, formatRounded } = useCurrency();

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

    void load();
    return () => { cancelled = true; };
  }, [id, navigate]);

  // No expenses passed: this page shows the plan, not what's been spent against
  // it — the dashboard and the snapshot are where utilization lives.
  const utilization = useMemo(
    () => (budget ? computeBudgetUtilization(budget, []) : null),
    [budget]
  );

  if (loading) {
    return (
      <Layout title="Budget">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  if (!budget || !utilization) return null;

  const { sections, totals } = utilization;
  const funded = nonEmptySections(sections);
  const days = periodDays(budget.startDate, budget.endDate);
  const label = budgetLabel(budget);

  // The row shows the prorated cost for this period; this says what the
  // subscription actually charges, which is what the reader recognises.
  const subscriptionDetail = (name: string) => {
    const sub = budget.subscriptions?.find(s => s.name === name);
    return sub ? `${formatMoney(sub.amount)} ${sub.frequency}` : null;
  };

  return (
    <Layout title="Budget">
      <div className="flex max-w-3xl flex-col gap-5 min-w-0">
        <BackLink to="/budgets" label="Budgets" />

        <PageHeader
          title={label}
          lede={
            <span className="inline-flex items-center gap-2">
              {budget.isActive ? (
                <Badge tone="primary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Active budget
                </Badge>
              ) : (
                <Badge tone="neutral" className="gap-1">
                  <Circle className="h-3 w-3" />
                  Inactive
                </Badge>
              )}
              <span>{days} days</span>
            </span>
          }
          action={
            <Button variant="outline" asChild>
              <Link to={`/budgets/${budget._id}/edit`}>Edit</Link>
            </Button>
          }
        />

        {/* ── Overview ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
          <StatRow>
            <Stat
              label="Allocated"
              value={formatRounded(totals.allocated)}
              hint={`${funded.length} ${funded.length === 1 ? 'section' : 'sections'}`}
            />
            <Stat label="Period" value={`${days} days`} hint={label} />
            <Stat
              label="Income"
              value={totals.income > 0 ? formatRounded(totals.income) : '—'}
              hint={totals.income > 0 ? 'expected' : 'not tracked'}
            />
            <Stat
              label={totals.unallocated < 0 ? 'Over income' : 'Unallocated'}
              value={totals.income > 0 ? formatRounded(Math.abs(totals.unallocated)) : '—'}
              hint={totals.income > 0 ? 'left to assign' : 'set an income'}
              tone={totals.income > 0 && totals.unallocated < 0 ? 'negative' : 'default'}
            />
          </StatRow>

          {totals.allocated > 0 && (
            <>
              <div className="mt-6 flex h-2.5 w-full gap-[2px]" aria-hidden="true">
                {funded.map(section => (
                  <div
                    key={section.key}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${(section.allocated / totals.allocated) * 100}%`,
                      backgroundColor: SECTION_COLOR[section.key],
                    }}
                  />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {funded.map(section => (
                  <span key={section.key} className="inline-flex items-center gap-1.5 text-footnote">
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: SECTION_COLOR[section.key] }}
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{section.label}</span>
                    <span className="font-semibold tnum">{formatRounded(section.allocated)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── Sections ─────────────────────────────────────────────────── */}
        {funded.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <p className="text-headline">Nothing allocated yet</p>
            <p className="mt-1.5 text-subhead text-muted-foreground">
              Edit this budget to plan your spending, investments and savings.
            </p>
            <Button className="mt-5" asChild>
              <Link to={`/budgets/${budget._id}/edit`}>Edit budget</Link>
            </Button>
          </div>
        ) : (
          funded.map(section => (
            <SectionCard
              key={section.key}
              section={section}
              totalAllocated={totals.allocated}
              detailFor={section.key === 'subscriptions' ? subscriptionDetail : undefined}
            />
          ))
        )}
      </div>
    </Layout>
  );
}

/** One section's allocations, read-only. */
function SectionCard({
  section,
  totalAllocated,
  detailFor,
}: {
  section: UtilizationSection;
  totalAllocated: number;
  /** Extra line under a row's name, e.g. a subscription's price and cadence. */
  detailFor?: (name: string) => string | null;
}) {
  const { formatMoney, formatRounded } = useCurrency();
  const Icon = SECTION_ICON[section.key];
  const meta = SECTION_META[section.key];
  const color = SECTION_COLOR[section.key];

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
      <SectionHeader
        title={
          <span className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] text-white"
              style={{ backgroundColor: color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            {section.label}
          </span>
        }
        subtitle={`${section.items.length} ${section.items.length === 1 ? 'line' : 'lines'} · ${meta.blurb}`}
        action={
          <div className="text-right">
            <p className="text-title-3 tnum">{formatRounded(section.allocated)}</p>
            {totalAllocated > 0 && (
              <p className="text-caption text-muted-foreground tnum">
                {Math.round((section.allocated / totalAllocated) * 100)}% of plan
              </p>
            )}
          </div>
        }
      />

      <ul className="mt-4 divide-y divide-border">
        {section.items.map(item => {
          const share = section.allocated > 0 ? (item.allocated / section.allocated) * 100 : 0;
          const detail = detailFor?.(item.category) ?? null;

          return (
            <li key={item.category} className="py-3 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-subhead font-medium">{item.category}</span>
                  {detail && (
                    <span className="block truncate text-caption text-muted-foreground">{detail}</span>
                  )}
                </span>
                <span className="flex-shrink-0 text-subhead font-semibold tnum">
                  {formatMoney(item.allocated)}
                </span>
                <span className="w-11 flex-shrink-0 text-right text-caption text-muted-foreground tnum">
                  {Math.round(share)}%
                </span>
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(share, 2)}%`,
                    backgroundColor: colorForName(item.category),
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
