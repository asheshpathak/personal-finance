import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import type { CategorySpend } from '@/lib/subscriptionTotals';

// Dark-friendly categorical palette, anchored on the brand violet. Distinct,
// vibrant hues that stay legible on the charcoal canvas.
const CHART_COLORS = [
  'hsl(255, 100%, 71%)', // violet (brand)
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

interface SubscriptionCategoryChartProps {
  data: CategorySpend[];
  formatAmount: (amount: number) => string;
}

export function SubscriptionCategoryChart({ data, formatAmount }: SubscriptionCategoryChartProps) {
  if (data.length === 0) {
    return (
      <Card className="rounded-2xl border shadow-sm p-5 sm:p-6">
        <h2 className="text-base font-semibold text-muted-foreground">Spend by category</h2>
        <p className="text-sm text-muted-foreground text-center py-10">
          Add subscriptions to see how your recurring spend breaks down by category.
        </p>
      </Card>
    );
  }

  const top = data[0];
  const chartData = data.map((item, i) => ({
    ...item,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <Card className="rounded-2xl border shadow-sm p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-muted-foreground">Spend by category</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Normalized to monthly spend</p>
        </div>
        <p className="text-xs text-muted-foreground sm:text-right">
          Highest: <span className="font-medium text-foreground">{top.category}</span>
          {' · '}
          <span className="tabular-nums">{formatAmount(top.amount)}/mo</span>
          {' '}
          <span className="tabular-nums">({top.percentage.toFixed(1)}%)</span>
        </p>
      </div>

      <div className="h-[220px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="amount"
              nameKey="category"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={2}
              strokeWidth={0}
            >
              {chartData.map(entry => (
                <Cell key={entry.category} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatAmount(Number(value ?? 0))}
              labelFormatter={(label) => String(label)}
              contentStyle={{
                borderRadius: '12px',
                border: '1px solid hsl(250 16% 22%)',
                background: 'hsl(250 22% 11%)',
                color: 'hsl(0 0% 98%)',
                fontSize: '13px',
              }}
              itemStyle={{ color: 'hsl(0 0% 98%)' }}
              labelStyle={{ color: 'hsl(252 13% 66%)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 sm:flex sm:flex-wrap sm:justify-center sm:gap-x-5">
        {chartData.map(item => (
          <div key={item.category} className="flex items-center gap-1.5 text-xs min-w-0">
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.fill }}
            />
            <span className="text-muted-foreground truncate">{item.category}</span>
            <span className="font-medium tabular-nums flex-shrink-0 ml-auto sm:ml-0">{item.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
