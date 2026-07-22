import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import type { CategorySpend } from '@/lib/subscriptionTotals';

const CHART_COLORS = [
  'hsl(25, 95%, 53%)',
  'hsl(220, 70%, 50%)',
  'hsl(262, 55%, 52%)',
  'hsl(160, 55%, 40%)',
  'hsl(330, 65%, 52%)',
  'hsl(195, 70%, 42%)',
  'hsl(45, 90%, 48%)',
  'hsl(240, 5%, 45%)',
  'hsl(25, 70%, 65%)',
  'hsl(240, 4%, 65%)',
  'hsl(25, 55%, 78%)',
  'hsl(240, 3%, 55%)',
  'hsl(25, 90%, 38%)',
  'hsl(240, 6%, 72%)',
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

      <div className="h-[220px] w-full">
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
                border: '1px solid hsl(240, 5.9%, 90%)',
                fontSize: '13px',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-4">
        {chartData.map(item => (
          <div key={item.category} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.fill }}
            />
            <span className="text-muted-foreground">{item.category}</span>
            <span className="font-medium tabular-nums">{item.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
