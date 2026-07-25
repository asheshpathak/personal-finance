import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import type { BudgetTotals, UtilizationItem, UtilizationSection } from '@/lib/budgetSections';

/**
 * Budget health for the ring + the per-row percentage. Only states that need
 * attention carry an icon; "on track" is the silent default. The text label is
 * always present (sr-only where the icon is absent) so status never rides on
 * color alone.
 */
type Status = {
  stroke: string;
  trackStroke: string;
  text: string;
  label: string;
  Icon: LucideIcon | null;
};

function getStatus(remaining: number, percentage: number): Status {
  if (remaining < 0) {
    return {
      stroke: 'stroke-destructive',
      trackStroke: 'stroke-destructive/20',
      text: 'text-destructive',
      label: 'Over budget',
      Icon: AlertTriangle,
    };
  }
  if (percentage >= 80) {
    return {
      stroke: 'stroke-amber-500',
      trackStroke: 'stroke-amber-500/20',
      text: 'text-amber-500',
      label: 'Nearly spent',
      Icon: AlertCircle,
    };
  }
  return {
    stroke: 'stroke-primary',
    trackStroke: 'stroke-primary/20',
    text: 'text-muted-foreground',
    label: 'On track',
    Icon: null,
  };
}

const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-2 sm:px-6 first:pl-0">
      <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.08em] sm:tracking-[0.1em] text-muted-foreground truncate">
        {label}
      </p>
      <p className="mt-1.5 text-base sm:text-2xl font-extrabold tracking-tight tabular-nums truncate">{value}</p>
      {sub && <p className="mt-1 text-[11px] sm:text-xs text-muted-foreground tabular-nums truncate">{sub}</p>}
    </div>
  );
}

/** Distinct per-category dot/bar hues, tuned for the charcoal canvas. */
const CATEGORY_COLORS = [
  'hsl(255, 100%, 71%)', // violet
  'hsl(322, 90%, 63%)',  // fuchsia
  'hsl(190, 90%, 55%)',  // cyan
  'hsl(38, 95%, 58%)',   // amber
  'hsl(152, 65%, 50%)',  // green
  'hsl(220, 92%, 68%)',  // blue
  'hsl(2, 85%, 67%)',    // coral
  'hsl(280, 72%, 70%)',  // light purple
  'hsl(170, 70%, 48%)',  // teal
  'hsl(48, 95%, 62%)',   // yellow
  'hsl(300, 75%, 72%)',  // magenta
  'hsl(212, 16%, 62%)',  // slate
  'hsl(255, 62%, 80%)',  // lavender
  'hsl(340, 82%, 68%)',  // rose
];

/**
 * A category keeps its hue for as long as it's in the budget.
 *
 * Assignment is by name within the section rather than by spend rank, so a
 * category doesn't change colour the moment a payment reorders the rows.
 */
function buildColorMap(sections: UtilizationSection[]): Map<string, string> {
  const map = new Map<string, string>();
  let slot = 0;
  for (const section of sections) {
    for (const item of [...section.items].sort((a, b) => a.category.localeCompare(b.category))) {
      if (map.has(item.category)) continue;
      map.set(item.category, CATEGORY_COLORS[slot % CATEGORY_COLORS.length]);
      slot += 1;
    }
  }
  return map;
}

/** One planned line inside a section. */
function ItemRow({
  item,
  color,
  revealed,
  formatAmount,
}: {
  item: UtilizationItem;
  color: string;
  revealed: boolean;
  formatAmount: (value: number) => string;
}) {
  const status = getStatus(item.remaining, item.percentage);
  // Keep a sliver visible for tiny non-zero spend, which would otherwise round
  // to an invisible bar and read as untouched.
  const width = item.spent > 0 ? Math.max(item.percentage, 2) : 0;

  return (
    <div
      className="flex items-center gap-3 sm:gap-4 py-3.5"
      title={`${item.category}: ${formatAmount(item.spent)} of ${formatAmount(item.allocated)}`}
    >
      <span
        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />

      <span className="w-28 sm:w-52 flex-shrink-0 truncate text-sm font-medium">{item.category}</span>

      <div className="flex-1 min-w-0 h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none"
          style={{ width: `${revealed ? width : 0}%`, backgroundColor: color }}
        />
      </div>

      <span className="hidden md:block flex-shrink-0 w-36 text-right text-xs text-muted-foreground tabular-nums">
        {formatAmount(item.spent)}
        <span className="text-muted-foreground/40"> / {formatAmount(item.allocated)}</span>
      </span>

      <span
        className={cn(
          'flex items-center justify-end gap-1 flex-shrink-0 w-16 text-right text-sm font-bold tabular-nums',
          status.text
        )}
      >
        {status.Icon && <status.Icon className="w-3.5 h-3.5" />}
        <span className="sr-only">{status.label}: </span>
        {Math.round(item.rawPercentage)}%
      </span>
    </div>
  );
}

export function BudgetUtilizationCard({
  startDate,
  endDate,
  sections,
  totals,
}: {
  startDate: string;
  endDate: string;
  /** Already filtered to the sections worth showing. */
  sections: UtilizationSection[];
  totals: BudgetTotals;
}) {
  const { formatAmount } = useCurrency();

  // Sweep the arc and meters out from zero on mount. Starting at 0 and flipping
  // to the real value one frame later lets CSS transitions do the animation.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const colorMap = buildColorMap(sections);
  const overall = getStatus(totals.remaining, totals.percentage);
  const arcOffset = CIRCUMFERENCE * (1 - (revealed ? totals.percentage : 0) / 100);

  const dateRange = `${new Date(startDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(endDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <Card className="relative overflow-hidden">
      {/* Ambient wash — pure decoration, kept behind the content and inert to AT. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl opacity-60',
          totals.remaining < 0 ? 'bg-destructive/10' : 'bg-primary/10'
        )}
      />

      <CardContent className="relative p-5 sm:p-7">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-7">
          <h3 className="text-base sm:text-lg font-bold tracking-tight">Active Budget Utilization</h3>
          <span className="text-xs sm:text-sm text-muted-foreground tabular-nums">{dateRange}</span>
        </div>

        {/* ── Summary band — bigger ring + structured stats ──────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-7 sm:gap-9 pb-7 mb-6 border-b border-white/[0.06]">
          <div className="relative flex-shrink-0 self-center sm:self-auto">
            <svg viewBox="0 0 148 148" className="-rotate-90 w-40 h-40 sm:w-44 sm:h-44">
              <circle cx="74" cy="74" r={RADIUS} fill="none" strokeWidth="10" className={overall.trackStroke} />
              <circle
                cx="74"
                cy="74"
                r={RADIUS}
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={arcOffset}
                className={cn(
                  overall.stroke,
                  'transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none'
                )}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-extrabold tracking-tighter tabular-nums leading-none">
                {Math.round(totals.rawPercentage)}
                <span className="text-xl align-top">%</span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1">used</span>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-3 divide-x divide-white/[0.08]">
            <Stat label="Spent" value={formatAmount(totals.spent)} sub={`of ${formatAmount(totals.allocated)}`} />
            <Stat
              label={totals.remaining < 0 ? 'Over by' : 'Remaining'}
              value={formatAmount(Math.abs(totals.remaining))}
              sub={
                <span className={cn('inline-flex items-center gap-1 font-semibold', overall.text)}>
                  {overall.Icon && <overall.Icon className="w-3 h-3" />}
                  {overall.label}
                </span>
              }
            />
            <Stat
              label="Days Left"
              value={totals.daysLeft === 0 ? '—' : String(totals.daysLeft)}
              sub={totals.daysLeft === 0 ? 'Period ended' : 'remaining'}
            />
          </div>
        </div>

        {/* ── Sections — spending, investments, savings, subscriptions ─────
            Only a quiet header separates them; the category rows below are
            unchanged, so the card still reads the way it always has. */}
        <div className="space-y-5">
          {sections.map(section => {
            const status = getStatus(section.remaining, section.percentage);

            return (
              <div key={section.key}>
                {/* A single-section budget needs no heading — that's the card. */}
                {sections.length > 1 && (
                  <div className="flex items-baseline justify-between gap-3 pb-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground truncate">
                      {section.label}
                    </span>
                    <span className="flex items-baseline gap-2 flex-shrink-0 text-xs tabular-nums">
                      <span className="text-muted-foreground">
                        {formatAmount(section.spent)}
                        <span className="text-muted-foreground/40"> / {formatAmount(section.allocated)}</span>
                      </span>
                      <span className={cn('font-bold w-10 text-right', status.text)}>
                        <span className="sr-only">{status.label}: </span>
                        {Math.round(section.rawPercentage)}%
                      </span>
                    </span>
                  </div>
                )}

                <div className="divide-y divide-white/[0.05]">
                  {section.items.map(item => (
                    <ItemRow
                      key={item.category}
                      item={item}
                      color={colorMap.get(item.category) ?? CATEGORY_COLORS[0]}
                      revealed={revealed}
                      formatAmount={formatAmount}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {totals.income > 0 && (
          <div className="mt-6 pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Income {formatAmount(totals.income)} · allocated {formatAmount(totals.allocated)}
            </span>
            <span className={cn('font-semibold tabular-nums', totals.unallocated < 0 && 'text-destructive')}>
              {totals.unallocated < 0 ? 'Over income by ' : 'Unallocated '}
              {formatAmount(Math.abs(totals.unallocated))}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
