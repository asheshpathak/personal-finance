import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleSlash, Plus } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import type { UnbudgetedSpend } from '@/lib/budgetSections';

/**
 * Spending inside the active budget's dates that no allocation covers.
 *
 * It is deliberately kept out of the utilization card above — a category with
 * no allocation can't be "80% used" — but it is the difference between the
 * headline total and the budgeted total, so it has to be visible somewhere.
 * One measure across nominal categories, so every bar wears the same hue.
 */
export function NonBudgetedSpendsCard({
  unbudgeted,
  budgetId,
}: {
  unbudgeted: UnbudgetedSpend;
  /** Links to the budget being edited, so a category can be planned in one hop. */
  budgetId: string;
}) {
  const { formatAmount } = useCurrency();

  if (unbudgeted.categories.length === 0) return null;

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
              <CircleSlash className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              Non-budgeted spends
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Paid during this budget's dates, but not planned for in any category.
            </p>
          </div>

          <div className="text-left sm:text-right flex-shrink-0">
            <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Total
            </p>
            <p className="mt-1 text-xl sm:text-2xl font-extrabold tracking-tight tabular-nums">
              {formatAmount(unbudgeted.total)}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {unbudgeted.transactions} {unbudgeted.transactions === 1 ? 'payment' : 'payments'}
            </p>
          </div>
        </div>

        <div className="divide-y divide-white/[0.05]">
          {unbudgeted.categories.map(row => (
            <div
              key={row.category}
              className="flex items-center gap-3 sm:gap-4 py-3.5"
              title={`${row.category}: ${formatAmount(row.amount)} across ${row.transactions} payments`}
            >
              <span className="w-28 sm:w-52 flex-shrink-0 truncate text-sm font-medium">{row.category}</span>

              <div className="flex-1 min-w-0 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-muted-foreground/50"
                  style={{ width: `${Math.max(row.share, 2)}%` }}
                />
              </div>

              <span className="hidden md:block flex-shrink-0 w-28 text-right text-xs text-muted-foreground tabular-nums">
                {row.transactions} {row.transactions === 1 ? 'payment' : 'payments'}
              </span>

              <span className="flex-shrink-0 w-24 sm:w-28 text-right text-sm font-bold tabular-nums">
                {formatAmount(row.amount)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-white/[0.06] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            These sit outside the utilization above. Add them to the budget to start tracking them.
          </p>
          <Button variant="outline" size="sm" className="flex-shrink-0 w-full sm:w-auto" asChild>
            <Link to={`/budgets/${budgetId}/edit`}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add to budget
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
