import { Lightbulb, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CONFIDENCE_LABEL, type Suggestion } from '@/lib/budgetIntel';
import type { CategoryGroup } from '@/lib/expenseCategories';

/**
 * "You spend on this every month but haven't planned for it."
 *
 * This is the single highest-value thing history can tell someone mid-plan.
 * The reason a budget quietly fails is almost never a line being 10% off — it
 * is a category with real, regular spending that was never in the plan at all,
 * so the money leaves without anywhere to charge it to.
 */
export function MissingCategories({
  suggestions,
  money,
  onAdd,
  onAddAll,
}: {
  suggestions: Suggestion[];
  money: (value: number) => string;
  onAdd: (suggestion: Suggestion) => void;
  onAddAll: () => void;
}) {
  if (suggestions.length === 0) return null;

  const total = suggestions.reduce((sum, s) => sum + s.amount, 0);

  const GROUP_LABEL: Record<CategoryGroup, string> = {
    spending: 'Spending',
    investments: 'Investments',
    savings: 'Savings',
  };

  return (
    <Card className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-callout">
              {suggestions.length} {suggestions.length === 1 ? 'category' : 'categories'} you spend on but haven't planned
            </CardTitle>
            <p className="mt-0.5 text-caption text-muted-foreground">
              Drawn from your last six months. Together they're worth about{' '}
              <span className="font-semibold tnum text-foreground">{money(total)}</span> over this period.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {suggestions.map(suggestion => (
          <button
            key={suggestion.category}
            type="button"
            onClick={() => onAdd(suggestion)}
            className="tactile flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-subtle px-3 py-2.5 text-left hover:border-primary/40 hover:bg-primary/[0.06]"
          >
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="truncate text-subhead font-semibold">{suggestion.category}</span>
                <span className="text-micro font-bold uppercase text-faint">
                  {GROUP_LABEL[suggestion.group]}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                {suggestion.rationale}
              </span>
            </span>
            <span className="flex-shrink-0 text-right">
              <span className="block text-subhead font-bold tnum">{money(suggestion.amount)}</span>
              <span
                className={cn(
                  'block text-micro font-semibold',
                  suggestion.confidence === 'high' ? 'text-positive-text'
                    : suggestion.confidence === 'medium' ? 'text-muted-foreground'
                    : 'text-warning-text'
                )}
              >
                {CONFIDENCE_LABEL[suggestion.confidence]}
              </span>
            </span>
          </button>
        ))}

        <Button type="button" variant="outline" className="w-full" onClick={onAddAll}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add all {suggestions.length} · {money(total)}
        </Button>
      </CardContent>
    </Card>
  );
}
