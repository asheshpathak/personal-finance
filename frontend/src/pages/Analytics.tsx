import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useCurrency } from '@/context/CurrencyContext';
import { AnalyticsFilterBar } from '@/components/analytics/AnalyticsFilterBar';
import { ChangeBadge } from '@/components/analytics/ChangeBadge';
import { ChartCard } from '@/components/analytics/ChartCard';
import {
  analyze,
  defaultFilters,
  formatRange,
  type AnalyticsExpense,
  WEEKDAY_NAMES,
  type AnalyticsFilters,
} from '@/lib/analytics';
import { CATEGORY_GROUP_LABELS, type CategoryGroup } from '@/lib/expenseCategories';
import {
  AXIS_TEXT,
  COMPARISON,
  GRID,
  PRIMARY,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  categoricalColor,
} from '@/lib/chartTheme';

/** How many category rows the bar chart shows before folding the rest into Other. */
const CATEGORY_ROWS = 10;

/** Surface colour behind the charts — used to cut the 2px gaps in stacked fills. */
const SURFACE = 'hsl(250 20% 9%)';

export default function Analytics() {
  const { formatAmount, currencySymbol } = useCurrency();

  const [expenses, setExpenses] = useState<AnalyticsExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.get<AnalyticsExpense[]>('/api/expenses');
        if (!cancelled) setExpenses(data);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  const result = useMemo(() => analyze(expenses, filters, formatAmount), [expenses, filters, formatAmount]);

  // Filter options come from the data, ranked by how much they're used, so the
  // chips a reader wants are the ones they see first.
  const { categoryOptions, paymentModeOptions } = useMemo(() => {
    const byCategory = new Map<string, number>();
    const byMode = new Map<string, number>();
    for (const e of expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
      if (e.paymentMode) byMode.set(e.paymentMode, (byMode.get(e.paymentMode) ?? 0) + 1);
    }
    const rank = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    return { categoryOptions: rank(byCategory), paymentModeOptions: rank(byMode) };
  }, [expenses]);

  /** Axis ticks need to stay short — the tooltip and table carry exact figures. */
  const compact = (value: number) =>
    `${currencySymbol}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;

  const categoryRows = useMemo(() => {
    const shown = result.categories.slice(0, CATEGORY_ROWS);
    const rest = result.categories.slice(CATEGORY_ROWS);
    if (rest.length === 0) return shown;
    // Never invent an 11th colour or an 11th row — the tail folds into one.
    return [
      ...shown,
      {
        category: `Other (${rest.length})`,
        group: 'spending' as CategoryGroup,
        amount: rest.reduce((sum, c) => sum + c.amount, 0),
        share: rest.reduce((sum, c) => sum + c.share, 0),
        transactions: rest.reduce((sum, c) => sum + c.transactions, 0),
        previousAmount: rest.reduce((sum, c) => sum + c.previousAmount, 0),
        delta: null,
      },
    ];
  }, [result.categories]);

  const peak = useMemo(
    () => result.trend.reduce<{ label: string; current: number } | null>(
      (best, point) => (best === null || point.current > best.current ? point : best),
      null
    ),
    [result.trend]
  );

  const busiestWeekday = useMemo(
    () => result.weekdays.reduce((best, day) => (day.average > best.average ? day : best), result.weekdays[0]),
    [result.weekdays]
  );

  if (loading) {
    return (
      <Layout>
        <div className="py-12 text-center text-muted-foreground">Loading analytics…</div>
      </Layout>
    );
  }

  const isEmpty = result.expenses.length === 0;

  return (
    <Layout>
      <div className="flex flex-col gap-5 sm:gap-6 min-w-0">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter">Analytics</h1>
          <p className="text-muted-foreground mt-1">
            {formatRange(result.range)} · compared with the {formatRange(result.previousRange)} before it.
          </p>
        </div>

        <AnalyticsFilterBar
          filters={filters}
          onChange={setFilters}
          categories={categoryOptions}
          paymentModes={paymentModeOptions}
          resultCount={result.expenses.length}
        />

        {isEmpty ? (
          <Card className="rounded-2xl p-10 text-center">
            <p className="font-semibold">No payments in this selection.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Widen the period or clear a filter to see your spending.
            </p>
          </Card>
        ) : (
          <>
            {/* ── Insights ─────────────────────────────────────────────── */}
            {result.insights.length > 0 && (
              <Card className="rounded-2xl border shadow-sm p-4 sm:p-5 min-w-0">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-3">
                  <Lightbulb className="w-3.5 h-3.5" />
                  What stands out
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {result.insights.map(insight => (
                    <li key={insight.id} className="flex gap-2 text-sm min-w-0">
                      <span
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0',
                          insight.tone === 'up'
                            ? 'bg-destructive'
                            : insight.tone === 'down'
                              ? 'bg-success'
                              : 'bg-primary'
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="font-semibold">{insight.lead}</span>{' '}
                        <span className="text-muted-foreground">{insight.body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* ── KPI row ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {result.kpis.map(kpi => (
                <Card key={kpi.label} className="rounded-2xl p-4 sm:p-5 min-w-0">
                  <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground truncate">
                    {kpi.label}
                  </p>
                  {/* Proportional figures: tabular-nums makes a headline number
                      look loose at this size. */}
                  <p className="mt-1.5 text-lg sm:text-xl lg:text-2xl font-extrabold tracking-tight break-words">
                    {kpi.format === 'currency' ? formatAmount(kpi.value) : Math.round(kpi.value)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ChangeBadge delta={kpi.delta} />
                    <span className="text-[11px] text-muted-foreground truncate">{kpi.hint}</span>
                  </div>
                </Card>
              ))}
            </div>

            {/* ── Trend ────────────────────────────────────────────────── */}
            <ChartCard
              title="Spending over time"
              subtitle={
                peak && peak.current > 0
                  ? `Per ${result.granularity} · peak ${peak.label} at ${formatAmount(peak.current)}`
                  : `Per ${result.granularity}`
              }
              action={
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: PRIMARY }} aria-hidden="true" />
                    This period
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-0.5 w-4 rounded-full"
                      style={{ backgroundImage: `repeating-linear-gradient(90deg, ${COMPARISON} 0 4px, transparent 4px 7px)` }}
                      aria-hidden="true"
                    />
                    Previous
                  </span>
                </div>
              }
              rows={result.trend}
              columns={[
                { header: result.granularity === 'month' ? 'Month' : 'Starting', cell: r => r.label },
                { header: 'This period', numeric: true, cell: r => formatAmount(r.current) },
                { header: 'Previous', numeric: true, cell: r => (r.previous === null ? '—' : formatAmount(r.previous)) },
                { header: 'Running total', numeric: true, cell: r => formatAmount(r.cumulative) },
              ]}
            >
              <div className="h-[260px] sm:h-[300px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={result.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: GRID }}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={compact}
                    />
                    <Tooltip
                      cursor={{ stroke: GRID, strokeWidth: 1 }}
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={(value, name) => [formatAmount(Number(value ?? 0)), String(name)]}
                    />
                    {/* Previous period is context: dashed and grey, so it reads as
                        a baseline rather than a competing series. */}
                    <Line
                      type="monotone"
                      dataKey="previous"
                      name="Previous"
                      stroke={COMPARISON}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="current"
                      name="This period"
                      stroke={PRIMARY}
                      strokeWidth={2}
                      fill="url(#trendFill)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            {/* ── Categories ───────────────────────────────────────────── */}
            <ChartCard
              title="Where the money went"
              subtitle={`${result.categories.length} categories · ranked by spend`}
              rows={result.categories}
              columns={[
                { header: 'Category', cell: r => r.category },
                { header: 'Spent', numeric: true, cell: r => formatAmount(r.amount) },
                { header: 'Share', numeric: true, cell: r => `${r.share.toFixed(1)}%` },
                { header: 'Payments', numeric: true, cell: r => r.transactions },
                { header: 'vs previous', numeric: true, cell: r => <ChangeBadge delta={r.delta} className="justify-end" /> },
              ]}
            >
              <div
                className="w-full min-w-0"
                style={{ height: Math.max(200, categoryRows.length * 34 + 24) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categoryRows}
                    layout="vertical"
                    margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                    barCategoryGap={6}
                  >
                    <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={compact}
                    />
                    {/* The category name on every row is the identity channel —
                        one hue for every bar, because length already encodes the
                        magnitude and a value-ramp would double-encode it. */}
                    <YAxis
                      type="category"
                      dataKey="category"
                      tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={132}
                      interval={0}
                    />
                    <Tooltip
                      cursor={{ fill: 'hsl(255 100% 69% / 0.08)' }}
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={(value) => [formatAmount(Number(value ?? 0)), 'Spent']}
                    />
                    <Bar dataKey="amount" fill={PRIMARY} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 min-w-0">
              {/* ── Payment mix — a composition bar, not a pie ──────────── */}
              <ChartCard
                title="How you paid"
                subtitle="Share of spend by payment mode"
                rows={result.paymentModes}
                columns={[
                  { header: 'Payment mode', cell: r => r.name },
                  { header: 'Spent', numeric: true, cell: r => formatAmount(r.amount) },
                  { header: 'Share', numeric: true, cell: r => `${r.share.toFixed(1)}%` },
                  { header: 'Payments', numeric: true, cell: r => r.transactions },
                ]}
              >
                <div className="space-y-4">
                  {/* 2px surface gaps between segments, never borders. */}
                  <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
                    {result.paymentModes.slice(0, 8).map((slice, i) => (
                      <div
                        key={slice.name}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{ width: `${Math.max(slice.share, 1)}%`, backgroundColor: categoricalColor(i) }}
                        title={`${slice.name}: ${slice.share.toFixed(1)}%`}
                      />
                    ))}
                  </div>

                  <ul className="space-y-2.5">
                    {result.paymentModes.slice(0, 8).map((slice, i) => (
                      <li key={slice.name} className="flex items-center gap-2.5 text-sm min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: categoricalColor(i) }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{slice.name}</span>
                        <span className="ml-auto flex-shrink-0 tabular-nums text-muted-foreground">
                          {formatAmount(slice.amount)}
                        </span>
                        <span className="w-12 flex-shrink-0 text-right tabular-nums font-semibold">
                          {slice.share.toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>

                  {result.groups.length > 1 && (
                    <div className="pt-3 border-t border-white/[0.06]">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2">
                        By type
                      </p>
                      <ul className="space-y-1.5">
                        {result.groups.map(group => (
                          <li key={group.name} className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">
                              {CATEGORY_GROUP_LABELS[group.name as CategoryGroup] ?? group.name}
                            </span>
                            <span className="ml-auto tabular-nums">{formatAmount(group.amount)}</span>
                            <span className="w-12 text-right tabular-nums font-semibold">
                              {group.share.toFixed(0)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </ChartCard>

              {/* ── Weekday rhythm ─────────────────────────────────────── */}
              <ChartCard
                title="Spending rhythm"
                subtitle={
                  busiestWeekday && busiestWeekday.average > 0
                    ? `Average per weekday · ${WEEKDAY_NAMES[busiestWeekday.day] ?? busiestWeekday.day} is your heaviest`
                    : 'Average per weekday'
                }
                rows={result.weekdays}
                columns={[
                  { header: 'Day', cell: r => r.day },
                  { header: 'Average', numeric: true, cell: r => formatAmount(r.average) },
                  { header: 'Total', numeric: true, cell: r => formatAmount(r.total) },
                  { header: 'Payments', numeric: true, cell: r => r.transactions },
                ]}
              >
                <div className="h-[260px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={result.weekdays} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
                      <XAxis
                        dataKey="day"
                        tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: GRID }}
                      />
                      <YAxis
                        tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickFormatter={compact}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(255 100% 69% / 0.08)' }}
                        contentStyle={TOOLTIP_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        formatter={(value) => [formatAmount(Number(value ?? 0)), 'Average']}
                      />
                      {/* Emphasis, not categorical: the heaviest day is the
                          point, the rest are context. */}
                      <Bar dataKey="average" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                        {result.weekdays.map(day => (
                          <Cell
                            key={day.day}
                            fill={PRIMARY}
                            fillOpacity={busiestWeekday && day.day === busiestWeekday.day ? 1 : 0.42}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </div>

            {/* ── Largest single payments ──────────────────────────────── */}
            <Card className="rounded-2xl border shadow-sm p-4 sm:p-6 min-w-0">
              <h2 className="text-base font-bold tracking-tight">Largest payments</h2>
              <p className="text-xs text-muted-foreground mt-0.5 mb-4">
                The biggest single entries in this period
              </p>
              <ul className="divide-y divide-white/[0.05]">
                {result.topExpenses.map(expense => (
                  <li key={expense._id} className="flex items-center gap-3 py-2.5 min-w-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {expense.description || expense.category}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {new Date(expense.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}
                        {expense.category}
                        {expense.paymentMode ? ` · ${expense.paymentMode}` : ''}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-sm font-bold tabular-nums">
                      {formatAmount(expense.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
