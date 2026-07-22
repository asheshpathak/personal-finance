import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Target, Calendar, AlertTriangle, AlertCircle, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';

export type CategoryUtilization = {
  category: string;
  allocated: number;
  spent: number;
  remaining: number;
  /** Capped at 100 — drives bar and arc geometry. */
  percentage: number;
  /** Uncapped — what gets displayed, so 140% doesn't read as 100%. */
  rawPercentage: number;
};

export type BudgetSummary = {
  allocated: number;
  spent: number;
  remaining: number;
  percentage: number;
  daysLeft: number;
};

/**
 * Budget health. Status never rides on color alone — every tier pairs its hue
 * with an icon and a text label so it survives colorblindness and greyscale.
 */
type Status = {
  stroke: string;
  trackStroke: string;
  fill: string;
  track: string;
  text: string;
  tile: string;
  label: string;
  Icon: LucideIcon;
};

function getStatus(remaining: number, percentage: number): Status {
  if (remaining < 0) {
    return {
      stroke: 'stroke-destructive',
      trackStroke: 'stroke-destructive/20',
      fill: 'bg-destructive',
      track: 'bg-destructive/15',
      text: 'text-destructive',
      tile: 'border-destructive/25 bg-destructive/[0.04] hover:border-destructive/40',
      label: 'Over budget',
      Icon: AlertTriangle,
    };
  }
  if (percentage >= 80) {
    return {
      stroke: 'stroke-amber-500',
      trackStroke: 'stroke-amber-500/20',
      fill: 'bg-amber-500',
      track: 'bg-amber-500/15',
      text: 'text-amber-600 dark:text-amber-500',
      tile: 'border-amber-500/25 bg-amber-500/[0.04] hover:border-amber-500/40',
      label: 'Nearly spent',
      Icon: AlertCircle,
    };
  }
  return {
    stroke: 'stroke-primary',
    trackStroke: 'stroke-primary/20',
    fill: 'bg-primary',
    track: 'bg-primary/15',
    text: 'text-muted-foreground',
    tile: 'border-border bg-muted/20 hover:border-primary/40',
    label: 'On track',
    Icon: Check,
  };
}

const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function BudgetUtilizationCard({
  startDate,
  endDate,
  categories,
  summary,
}: {
  startDate: string;
  endDate: string;
  categories: CategoryUtilization[];
  summary: BudgetSummary;
}) {
  const { formatAmount } = useCurrency();

  // Sweep the arc and meters out from zero on mount. Starting at 0 and flipping
  // to the real value one frame later lets CSS transitions do the animation.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const overall = getStatus(summary.remaining, summary.percentage);
  const arcOffset = CIRCUMFERENCE * (1 - (revealed ? summary.percentage : 0) / 100);

  const dateRange = `${new Date(startDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} - ${new Date(endDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <Card className="relative overflow-hidden rounded-2xl border-muted bg-card shadow-sm">
      {/* Ambient wash — pure decoration, kept behind the content and inert to AT. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl opacity-60',
          summary.remaining < 0 ? 'bg-destructive/10' : 'bg-primary/10'
        )}
      />

      <CardContent className="relative p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-6">
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Target className="w-5 h-5 text-primary flex-shrink-0" />
            Active Budget Utilization
          </h3>
          <span className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1.5">
            <Calendar className="w-4 h-4 flex-shrink-0" />
            {dateRange}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-8">
          {/* ── Overall gauge ─────────────────────────────────────────── */}
          <div className="flex items-center gap-5 lg:flex-col lg:gap-4 lg:w-44 lg:flex-shrink-0">
            <div className="relative flex-shrink-0">
              <svg width="148" height="148" viewBox="0 0 148 148" className="-rotate-90">
                <circle
                  cx="74"
                  cy="74"
                  r={RADIUS}
                  fill="none"
                  strokeWidth="11"
                  className={overall.trackStroke}
                />
                <circle
                  cx="74"
                  cy="74"
                  r={RADIUS}
                  fill="none"
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={arcOffset}
                  className={cn(overall.stroke, 'transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none')}
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold tracking-tighter tabular-nums leading-none">
                  {Math.round(summary.percentage)}
                  <span className="text-lg align-top">%</span>
                </span>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                  used
                </span>
              </div>
            </div>

            <div className="min-w-0 lg:text-center">
              <div className="text-xl sm:text-2xl font-bold tracking-tighter tabular-nums">
                {formatAmount(summary.spent)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                of {formatAmount(summary.allocated)}
              </div>

              <div
                className={cn(
                  'mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  overall.tile,
                  overall.text
                )}
              >
                <overall.Icon className="w-3 h-3" />
                {overall.label}
              </div>

              <div className="text-[11px] text-muted-foreground mt-2 tabular-nums leading-relaxed">
                <div>
                  {summary.daysLeft === 0
                    ? 'Period ended'
                    : `${summary.daysLeft} ${summary.daysLeft === 1 ? 'day' : 'days'} left`}
                </div>
                <div>
                  {summary.remaining < 0
                    ? `${formatAmount(Math.abs(summary.remaining))} over`
                    : `${formatAmount(summary.remaining)} remaining`}
                </div>
              </div>
            </div>
          </div>

          {/* ── Category tiles ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 flex-1 min-w-0">
            {categories.map(cat => {
              const status = getStatus(cat.remaining, cat.percentage);
              // Keep a sliver visible for tiny non-zero spend, which would
              // otherwise round to an invisible bar and read as untouched.
              const width = cat.spent > 0 ? Math.max(cat.percentage, 3) : 0;

              return (
                <div
                  key={cat.category}
                  className={cn(
                    'group rounded-xl border p-3.5 transition-all duration-200 hover:shadow-sm',
                    status.tile
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <span className="text-xs font-semibold text-muted-foreground truncate leading-tight">
                      {cat.category}
                    </span>
                    <span
                      className={cn(
                        'flex items-center gap-1 text-[11px] font-bold tabular-nums flex-shrink-0',
                        status.text
                      )}
                    >
                      <status.Icon className="w-3 h-3" />
                      <span className="sr-only">{status.label}: </span>
                      {Math.round(cat.rawPercentage)}%
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1.5 mb-2.5">
                    <span
                      className={cn(
                        'text-lg font-bold tracking-tighter tabular-nums leading-none',
                        cat.remaining < 0 ? status.text : 'text-foreground'
                      )}
                    >
                      {formatAmount(cat.spent)}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums truncate">
                      / {formatAmount(cat.allocated)}
                    </span>
                  </div>

                  <div className={cn('h-1.5 w-full rounded-full overflow-hidden', status.track)}>
                    <div
                      className={cn('h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none', status.fill)}
                      style={{ width: `${revealed ? width : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
