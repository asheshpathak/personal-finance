import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

export type CategorySpend = { category: string; amount: number };

/**
 * Horizontal bar chart of spend per category.
 *
 * This is a magnitude comparison (which category is biggest), not an identity
 * question — so it uses ONE hue, not a categorical palette. More spend = more
 * saturated, which reads as "hotter" without needing a legend. Bars are
 * horizontal because category names are long ("Vices (smoking/drinking)").
 */
export function CategorySpendChart({
  expenses,
  formatAmount,
}: {
  expenses: { category: string; amount: number }[];
  formatAmount: (amount: number) => string;
}) {
  const totals = new Map<string, number>();
  for (const e of expenses) {
    totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  }

  const data: CategorySpend[] = [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .filter(d => d.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const grandTotal = data.reduce((sum, d) => sum + d.amount, 0);
  const max = data[0]?.amount ?? 0;

  // Fade the single hue from full strength (biggest) to ~45% (smallest) so the
  // ranking is legible from color alone, while the bar length carries the value.
  const fillFor = (amount: number) => {
    const t = max > 0 ? amount / max : 0;
    const opacity = 0.45 + 0.55 * t;
    return `hsl(25 95% 53% / ${opacity})`;
  };

  return (
    <Card className="rounded-2xl border-muted bg-card shadow-sm overflow-hidden">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between mb-5">
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary flex-shrink-0" />
            Spending by Category
          </h3>
          {grandTotal > 0 && (
            <p className="text-xs sm:text-sm text-muted-foreground tabular-nums">
              {formatAmount(grandTotal)} across {data.length}{' '}
              {data.length === 1 ? 'category' : 'categories'}
            </p>
          )}
        </div>

        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <BarChart3 className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No spending yet. Record an expense to see the breakdown.
            </p>
          </div>
        ) : (
          <div
            className="w-full min-w-0"
            // ~44px a row keeps bars tappable and labels readable; grows with count.
            style={{ height: Math.max(data.length * 44 + 16, 120) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={data}
                margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                barCategoryGap={8}
              >
                <XAxis type="number" hide domain={[0, max]} />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={112}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: 'hsl(240 3.8% 46.1%)' }}
                  // Truncate long names so the plot area stays wide.
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(240 4.8% 95.9% / 0.6)' }}
                  formatter={(value) => [formatAmount(Number(value ?? 0)), 'Spent']}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid hsl(240 5.9% 90%)',
                    fontSize: '13px',
                    padding: '8px 12px',
                  }}
                />
                <Bar dataKey="amount" radius={[4, 4, 4, 4]} isAnimationActive={false}>
                  {data.map(d => (
                    <Cell key={d.category} fill={fillFor(d.amount)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
