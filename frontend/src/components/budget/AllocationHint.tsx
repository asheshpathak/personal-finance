import { Sparkles, TrendingDown, TrendingUp, Info, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONFIDENCE_LABEL, type Suggestion } from '@/lib/budgetIntel';

/**
 * The inline suggestion under one allocation row.
 *
 * The design constraint here is that a suggestion must never feel like a nag.
 * It shows what history says the line costs, one tap applies it, and the
 * reasoning is right there — so accepting it is a decision rather than
 * compliance. Once the typed figure is close to the suggestion it stops
 * offering and just confirms, which is what keeps it from becoming noise.
 */
export function AllocationHint({
  suggestion,
  current,
  onApply,
  money,
}: {
  suggestion: Suggestion | null;
  /** What's currently typed into the row. */
  current: number;
  onApply: (amount: number) => void;
  money: (value: number) => string;
}) {
  if (!suggestion || suggestion.amount <= 0) return null;

  // Within 5% counts as agreement — re-offering a number they've effectively
  // already chosen is the fastest way to make a hint feel like clutter.
  const matched = current > 0 && Math.abs(current - suggestion.amount) / suggestion.amount < 0.05;
  const gap = current > 0 ? current - suggestion.amount : 0;
  const TrendIcon = suggestion.trend > 0.15 ? TrendingUp : suggestion.trend < -0.15 ? TrendingDown : null;

  return (
    <div className="mt-1.5 min-w-0 rounded-lg border border-border bg-subtle px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {matched ? (
          <span className="inline-flex items-center gap-1.5 text-micro font-semibold text-positive-text">
            <Check className="h-3 w-3" />
            Matches your history
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onApply(suggestion.amount)}
            className="tactile inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 h-7 text-micro font-bold text-primary hover:bg-primary/20"
          >
            <Sparkles className="h-3 w-3" />
            Use {money(suggestion.amount)}
          </button>
        )}

        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-micro font-bold uppercase ',
            suggestion.confidence === 'high' ? 'bg-positive-tint text-positive-text'
              : suggestion.confidence === 'medium' ? 'bg-hover text-muted-foreground'
              : 'bg-warning-tint text-warning-text'
          )}
          title={`Based on ${suggestion.monthsWithSpend} of the last ${suggestion.monthsObserved} months`}
        >
          {CONFIDENCE_LABEL[suggestion.confidence]}
        </span>

        {TrendIcon && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-micro font-semibold tnum',
              suggestion.trend > 0 ? 'text-destructive' : 'text-positive-text'
            )}
          >
            <TrendIcon className="h-3 w-3" />
            {Math.abs(Math.round(suggestion.trend * 100))}%
          </span>
        )}

        {/* Only shown once there is a figure to disagree with. */}
        {!matched && current > 0 && (
          <span
            className={cn(
              'ml-auto text-micro font-semibold tnum',
              gap > 0 ? 'text-muted-foreground' : 'text-destructive'
            )}
          >
            {gap > 0 ? `${money(gap)} above` : `${money(-gap)} below`} your usual
          </span>
        )}
      </div>

      <p className="mt-1.5 flex gap-1.5 text-micro leading-snug text-muted-foreground">
        <Info className="mt-[1px] h-3 w-3 flex-shrink-0" />
        <span className="min-w-0">{suggestion.rationale}</span>
      </p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-micro tnum text-faint">
        <span>median {money(suggestion.median)}</span>
        <span>last month {money(suggestion.lastMonth)}</span>
        <span>recent avg {money(suggestion.recentMean)}</span>
      </div>
    </div>
  );
}
