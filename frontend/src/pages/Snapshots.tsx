import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  GitCompare,
  Info,
  PiggyBank,
  Repeat,
  Target,
  TrendingUp,
  Wallet,
  Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented';
import { Stat, StatRow, Delta } from '@/components/ui/stat';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { useFinances } from '@/lib/useFinances';
import { type SectionKey } from '@/lib/budgetSections';
import {
  buildRecommendations,
  buildSnapshot,
  budgetLabel,
  nextPeriod,
  STATUS_META,
  type LineVariance,
  type PlanRecommendation,
  type SnapshotExpense,
} from '@/lib/snapshots';

/**
 * Planned against actual.
 *
 * The insights page answers "where did the money go". This answers the
 * different and harder question — *did the money go where I said it would* —
 * and then turns the answer into next period's starting numbers, which is the
 * only part that changes anything.
 */

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

const VERDICT = {
  over: { label: 'Over plan', tone: 'negative' as const },
  tight: { label: 'Running tight', tone: 'warning' as const },
  'on-track': { label: 'On plan', tone: 'positive' as const },
  under: { label: 'Under plan', tone: 'positive' as const },
};

/**
 * Plan against actual, as one bar.
 *
 * Two bars side by side make the reader do the subtraction. One track with the
 * plan marked on it turns the question into a glance: is the fill short of the
 * notch, or past it.
 */
function VarianceBar({ planned, actual, color }: { planned: number; actual: number; color: string }) {
  const ceiling = Math.max(planned, actual, 1);
  const plannedPct = (planned / ceiling) * 100;
  const actualPct = (actual / ceiling) * 100;
  const over = actual > planned && planned > 0;

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-spring"
        style={{
          width: `${Math.min(actualPct, 100)}%`,
          backgroundColor: over ? 'hsl(var(--destructive))' : color,
        }}
      />
      {planned > 0 && (
        <span
          className="absolute inset-y-[-2px] w-[2px] rounded-full bg-foreground/60"
          style={{ left: `calc(${Math.min(plannedPct, 100)}% - 1px)` }}
          aria-hidden="true"
          title="Planned"
        />
      )}
    </div>
  );
}

function LineRow({ line, money }: { line: LineVariance; money: (v: number) => string }) {
  const meta = STATUS_META[line.status];
  return (
    <li className="py-3 min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-subhead font-medium">{line.category}</span>
        <span className="flex-shrink-0 text-subhead font-semibold tnum">{money(line.actual)}</span>
      </div>

      <VarianceBar planned={line.planned} actual={line.actual} color="hsl(var(--chart-1))" />

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-muted-foreground">
        <span className="tnum">
          {line.planned > 0 ? <>of {money(line.planned)} planned</> : 'not planned'}
        </span>
        <Badge
          size="sm"
          tone={meta.tone === 'over' ? 'negative' : meta.tone === 'under' ? 'positive' : 'neutral'}
        >
          {meta.label}
        </Badge>
        {line.planned > 0 && <span className="tnum">{Math.round(line.usedPct)}% used</span>}
        <Delta
          value={line.variance}
          format={money}
          className="ml-auto"
        />
      </div>
    </li>
  );
}

export default function Snapshots() {
  const { formatAmount, formatMoney, formatRounded } = useCurrency();
  const navigate = useNavigate();
  const { budgets, expenses, loading, ready } = useFinances({ subscriptions: false });

  const [selectedId, setSelectedId] = useState<string>('');
  const [applied, setApplied] = useState<Set<string>>(new Set());

  /** Newest period first — the order a reader thinks in. */
  const ordered = useMemo(
    () => [...budgets].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    [budgets]
  );

  // Open on the active budget — the one the reader is living in.
  const [initialised, setInitialised] = useState(false);
  if (!initialised && ordered.length > 0) {
    setInitialised(true);
    setSelectedId((ordered.find(b => b.isActive) ?? ordered[0]!)._id);
  }

  const selected = ordered.find(b => b._id === selectedId) ?? ordered[0] ?? null;

  const snapshot = useMemo(
    () => (selected ? buildSnapshot(selected, expenses as SnapshotExpense[], formatAmount) : null),
    [selected, expenses, formatAmount]
  );

  const recommendations = useMemo(
    () => (snapshot ? buildRecommendations(snapshot, expenses as SnapshotExpense[], formatAmount) : []),
    [snapshot, expenses, formatAmount]
  );

  // Acceptances belong to the snapshot they were made on. Carrying them across
  // a period change would write July's figures into June's carry-forward for
  // lines the reader never ticked there.
  const [appliedFor, setAppliedFor] = useState('');
  if (appliedFor !== selectedId) {
    setAppliedFor(selectedId);
    if (applied.size > 0) setApplied(new Set());
  }

  const toggleApplied = (category: string) =>
    setApplied(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  /**
   * Hands the accepted numbers to the budget form as the starting plan, so
   * "next month should look like this" becomes an actual next month in one tap.
   */
  const planNext = (useAll: boolean) => {
    if (!snapshot) return;
    const period = nextPeriod(snapshot);

    const chosen = recommendations.filter(r => useAll || applied.has(r.category));
    const overrides = new Map(chosen.map(r => [r.category, r.suggested]));

    const rowsFor = (section: SectionKey) => {
      const existing =
        snapshot.sections
          .find(s => s.key === section)
          ?.lines.map(l => ({
            name: l.category,
            allocatedAmount: overrides.get(l.category) ?? l.planned,
          })) ?? [];
      // Recommendations for categories the old plan never had.
      const added = chosen
        .filter(r => r.section === section && !existing.some(e => e.name === r.category))
        .map(r => ({ name: r.category, allocatedAmount: r.suggested }));
      return [...existing, ...added].filter(r => r.allocatedAmount > 0);
    };

    navigate('/budgets/new', {
      state: {
        prefill: {
          startDate: period.start,
          endDate: period.end,
          income: snapshot.budget.income ?? 0,
          categories: rowsFor('expenses'),
          investments: rowsFor('investments'),
          savings: rowsFor('savings'),
          subscriptions: snapshot.budget.subscriptions ?? [],
          from: snapshot.label,
        },
      },
    });
  };

  if (loading && !ready) {
    return (
      <Layout title="Snapshots">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  if (!snapshot) {
    return (
      <Layout title="Snapshots">
        <PageHeader
          title="Snapshots"
          lede="What you planned against what actually happened."
        />
        <EmptyState
          className="mt-6"
          icon={GitCompare}
          title="Nothing to compare against yet"
          body="A snapshot measures spending against a plan — so it needs a plan first."
          action={
            <Button asChild>
              <Link to="/budgets/new">Create a budget</Link>
            </Button>
          }
        />
      </Layout>
    );
  }

  const { headline, pacing } = snapshot;
  const verdict = VERDICT[headline.verdict];
  const sections = snapshot.sections.filter(s => s.lines.length > 0);

  return (
    <Layout title="Snapshots">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Snapshots"
          lede="What you planned against what happened — and the numbers to carry into the next one."
        />

        {/* Its own row so the picker never fights the header for space. */}
        {ordered.length > 1 && (
          <SegmentedControl
            ariaLabel="Budget period"
            size="sm"
            value={selected?._id ?? ''}
            onChange={setSelectedId}
            options={ordered.map(b => ({
              value: b._id,
              label: (
                <span className="flex items-center gap-1.5">
                  {budgetLabel(b)}
                  {b.isActive && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Active" />
                  )}
                </span>
              ),
            }))}
          />
        )}

        {/* ── Headline ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-7 min-w-0">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-overline uppercase text-faint">
                <span>
                  {snapshot.label} · {snapshot.days} days
                </span>
                {pacing.live && <Badge tone="primary" size="sm">in progress</Badge>}
              </p>

              <div className="mt-3">
                <Badge tone={verdict.tone} size="lg">{verdict.label}</Badge>
              </div>

              <p className="mt-3 text-display tnum">{formatRounded(headline.actual)}</p>
              <p className="text-subhead text-muted-foreground tnum">
                of {formatRounded(headline.planned)} planned
              </p>

              <p className="mt-4 max-w-2xl text-subhead text-muted-foreground">{headline.summary}</p>
            </div>

            <div className="grid flex-shrink-0 grid-cols-2 gap-x-8 gap-y-5 lg:text-right">
              <Figure
                label="Variance"
                value={formatRounded(Math.abs(headline.variance))}
                hint={headline.variance > 0 ? 'over plan' : 'under plan'}
                tone={headline.variance > 0 ? 'bad' : 'good'}
              />
              <Figure
                label="Not planned for"
                value={formatRounded(snapshot.unplannedTotal)}
                hint={`${snapshot.unplanned.length} categories`}
                tone={snapshot.unplannedTotal > 0 ? 'bad' : 'neutral'}
              />
              {headline.income > 0 && (
                <>
                  <Figure label="Income" value={formatRounded(headline.income)} hint="expected" />
                  <Figure
                    // The label flips rather than the caption contradicting it:
                    // "Left over — overspent" is a sentence that means nothing.
                    label={headline.netSaved >= 0 ? 'Left over' : 'Overspent by'}
                    value={formatRounded(Math.abs(headline.netSaved))}
                    hint={headline.netSaved >= 0 ? 'after everything' : 'beyond income'}
                    tone={headline.netSaved >= 0 ? 'good' : 'bad'}
                  />
                </>
              )}
            </div>
          </div>

          {/* Pace: how far through the period against how far through the money. */}
          {pacing.live && headline.planned > 0 && (
            <div className="mt-6 border-t border-border pt-5">
              <div className="mb-2 flex items-center justify-between gap-3 text-caption font-semibold text-muted-foreground tnum">
                <span>Budget used · {Math.round(pacing.spentPct)}%</span>
                <span>Period elapsed · {Math.round(pacing.elapsedPct)}%</span>
              </div>

              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-spring',
                    pacing.spentPct > pacing.elapsedPct + 10 ? 'bg-destructive' : 'bg-primary'
                  )}
                  style={{ width: `${Math.min(pacing.spentPct, 100)}%` }}
                />
                <span
                  className="absolute inset-y-[-3px] w-[3px] rounded-full bg-foreground/70"
                  style={{ left: `calc(${Math.min(pacing.elapsedPct, 100)}% - 1.5px)` }}
                  aria-hidden="true"
                  title="Where the calendar is"
                />
              </div>

              <p className="mt-2.5 text-footnote text-muted-foreground tnum">
                {formatRounded(pacing.burnRate)}/day so far
                {pacing.projected !== null && (
                  <> · on pace to finish at {formatRounded(pacing.projected)}</>
                )}
                {pacing.safeDailySpend !== null && (
                  <> · {formatRounded(pacing.safeDailySpend)}/day keeps it on plan</>
                )}
              </p>
            </div>
          )}
        </section>

        {/* ── Where the money went ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
          <SectionHeader
            title="Where the money went"
            subtitle="Every category with spending in this period, biggest first"
          />

          {snapshot.flow.length === 0 ? (
            <p className="py-8 text-center text-subhead text-muted-foreground">
              Nothing recorded in this period yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {snapshot.flow.slice(0, 12).map(item => (
                <li key={`${item.section}-${item.category}`} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-subhead">
                    <span className="min-w-0 flex-1 truncate">{item.category}</span>
                    <span className="flex-shrink-0 text-caption text-muted-foreground tnum">
                      {item.transactions} {item.transactions === 1 ? 'payment' : 'payments'}
                    </span>
                    <span className="w-24 flex-shrink-0 text-right font-semibold tnum">
                      {formatMoney(item.amount)}
                    </span>
                    <span className="w-11 flex-shrink-0 text-right text-caption text-muted-foreground tnum">
                      {item.share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: `${Math.max(item.share, 0.5)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── The two lists that actually change behaviour ─────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 min-w-0">
          <DriverCard
            title="Biggest overruns"
            blurb="Where the plan was beaten, worst first"
            empty="Nothing went over plan."
            lines={snapshot.overspends.slice(0, 6)}
            money={formatMoney}
          />
          <DriverCard
            title="Money left on the table"
            blurb="Planned but never spent"
            empty="Every planned line was used."
            lines={snapshot.underspends.slice(0, 6)}
            money={formatMoney}
          />
        </div>

        {/* ── Section by section ───────────────────────────────────────── */}
        {sections.map(section => {
          const Icon = SECTION_ICON[section.key];
          return (
            <section
              key={section.key}
              className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0"
            >
              <SectionHeader
                title={
                  <span className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] text-white"
                      style={{ backgroundColor: SECTION_COLOR[section.key] }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {section.label}
                  </span>
                }
                subtitle={
                  <span className="tnum">
                    {formatRounded(section.actual)} of {formatRounded(section.planned)} planned
                    {section.planned > 0 && <> · {Math.round(section.usedPct)}%</>}
                  </span>
                }
                action={<Delta value={section.variance} format={formatRounded} />}
              />

              <div className="mt-4">
                <VarianceBar
                  planned={section.planned}
                  actual={section.actual}
                  color={SECTION_COLOR[section.key]}
                />
              </div>

              <ul className="mt-2 divide-y divide-border">
                {section.lines.map(line => (
                  <LineRow key={line.category} line={line} money={formatMoney} />
                ))}
              </ul>
            </section>
          );
        })}

        {/* ── Spending the plan never covered ──────────────────────────── */}
        {snapshot.unplanned.length > 0 && (
          <section className="rounded-2xl border border-destructive-border bg-destructive-tint p-5 sm:p-6 min-w-0">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] bg-destructive/15 text-destructive-text">
                <Target className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-headline tnum">
                  {formatRounded(snapshot.unplannedTotal)} the plan never covered
                </h2>
                <p className="mt-0.5 text-footnote text-muted-foreground">
                  Real spending inside these dates with no line to charge it to. This is usually the
                  single biggest reason a budget "fails".
                </p>
              </div>
            </div>

            <ul className="mt-4 divide-y divide-destructive-border">
              {snapshot.unplanned.map(line => (
                <LineRow key={line.category} line={line} money={formatMoney} />
              ))}
            </ul>
          </section>
        )}

        {/* ── Carry forward ────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-primary-border bg-primary-tint p-5 sm:p-6 min-w-0">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] bg-primary text-primary-foreground">
              <Wand2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-headline">Plan the next one</h2>
              <p className="mt-0.5 text-footnote text-muted-foreground">
                Every number below is your own history, not a rule of thumb. Take the ones you agree
                with, or take the lot.
              </p>
            </div>
          </div>

          {recommendations.length === 0 ? (
            <p className="py-6 text-center text-subhead text-muted-foreground">
              This plan already matches how you actually spend — nothing worth changing.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {recommendations.map(rec => (
                <RecommendationRow
                  key={rec.category}
                  rec={rec}
                  money={formatRounded}
                  checked={applied.has(rec.category)}
                  onToggle={() => toggleApplied(rec.category)}
                />
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-primary-border pt-4 sm:flex-row">
            <Button variant="outline" className="sm:flex-1" onClick={() => planNext(false)}>
              Start next budget
              {applied.size > 0 && <span className="tnum">({applied.size} applied)</span>}
            </Button>
            <Button
              size="lg"
              className="sm:flex-1"
              onClick={() => planNext(true)}
              disabled={recommendations.length === 0}
            >
              Apply all &amp; plan next
              <ArrowRight />
            </Button>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function Figure({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-overline uppercase text-faint">{label}</p>
      <p
        className={cn(
          'mt-1 text-title-3 tnum',
          tone === 'bad' && 'text-destructive-text',
          tone === 'good' && 'text-positive-text'
        )}
      >
        {value}
      </p>
      {hint && <p className="truncate text-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DriverCard({
  title,
  blurb,
  empty,
  lines,
  money,
}: {
  title: string;
  blurb: string;
  empty: string;
  lines: LineVariance[];
  money: (v: number) => string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
      <SectionHeader title={title} subtitle={blurb} />
      {lines.length === 0 ? (
        <p className="py-6 text-center text-subhead text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {lines.map(line => (
            <LineRow key={`${line.section}-${line.category}`} line={line} money={money} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecommendationRow({
  rec,
  money,
  checked,
  onToggle,
}: {
  rec: PlanRecommendation;
  money: (v: number) => string;
  checked: boolean;
  onToggle: () => void;
}) {
  const tone = rec.change === 'add' ? 'primary' : rec.change === 'raise' ? 'negative' : 'positive';
  const label = rec.change === 'add' ? 'Add' : rec.change === 'raise' ? 'Raise' : 'Lower';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        className={cn(
          'tactile flex w-full min-w-0 items-start gap-3 rounded-xl border p-3.5 text-left',
          checked ? 'border-primary bg-card' : 'border-border bg-card/60 hover:bg-card'
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors',
            checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong'
          )}
          aria-hidden="true"
        >
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-subhead font-semibold">{rec.category}</span>
            <Badge tone={tone} size="sm">{label}</Badge>
            <span className="ml-auto flex items-baseline gap-1.5 tnum">
              {rec.planned > 0 && (
                <span className="text-caption text-faint line-through">{money(rec.planned)}</span>
              )}
              <span className="text-subhead font-bold">{money(rec.suggested)}</span>
            </span>
          </span>
          <span className="mt-1.5 flex gap-1.5 text-caption text-muted-foreground">
            <Info className="mt-[2px] h-3 w-3 flex-shrink-0" />
            <span className="min-w-0">{rec.reason}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

export { Stat, StatRow };
