import { useMemo, useState } from 'react';
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
import { ChartPie, Lightbulb } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { EmptyState, PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { Stat, StatRow, Delta } from '@/components/ui/stat';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { useFinances } from '@/lib/useFinances';
import { AnalyticsFilterBar } from '@/components/analytics/AnalyticsFilterBar';
import { ChartCard } from '@/components/analytics/ChartCard';
import { SankeyFlow } from '@/components/analytics/SankeyFlow';
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
  SURFACE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  categoricalColor,
  colorForName,
} from '@/lib/chartTheme';

/** How many category rows the bar chart shows before folding the rest into Other. */
const CATEGORY_ROWS = 10;

export default function Analytics() {
  const { formatAmount, formatMoney, formatRounded, formatCompact } = useCurrency();
  const { expenses, activeBudget, loading, ready } = useFinances({ subscriptions: false });

  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);

  const result = useMemo(
    // Rounded, not exact: these figures land inside sentences, where the
    // decimals are noise rather than precision.
    () => analyze(expenses as AnalyticsExpense[], filters, formatRounded),
    [expenses, filters, formatRounded]
  );

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
    () =>
      result.trend.reduce<{ label: string; current: number } | null>(
        (best, point) => (best === null || point.current > best.current ? point : best),
        null
      ),
    [result.trend]
  );

  const busiestWeekday = useMemo(
    () => result.weekdays.reduce((best, day) => (day.average > best.average ? day : best), result.weekdays[0]!),
    [result.weekdays]
  );

  /** The Sankey uses the *filtered* slice, so it always agrees with the page. */
  const flowIncome = useMemo(() => {
    if (!activeBudget?.income) return 0;
    // Income is stated per budget period; the analytics range is arbitrary. So
    // it is prorated to the range rather than shown whole, which would make the
    // "left over" ribbon a fiction whenever the two windows differ.
    const budgetDays = Math.max(
      1,
      Math.round(
        (new Date(activeBudget.endDate).getTime() - new Date(activeBudget.startDate).getTime()) /
          86_400_000
      ) + 1
    );
    const rangeDays = Math.max(
      1,
      Math.round((result.range.end.getTime() - result.range.start.getTime()) / 86_400_000) + 1
    );
    return (activeBudget.income / budgetDays) * rangeDays;
  }, [activeBudget, result.range]);

  if (loading && !ready) {
    return (
      <Layout title="Insights" wide>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  const isEmpty = result.expenses.length === 0;

  return (
    <Layout title="Insights" wide>
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Insights"
          lede={
            <>
              {formatRange(result.range)} · compared with the {formatRange(result.previousRange)}{' '}
              before it.
            </>
          }
        />

        <AnalyticsFilterBar
          filters={filters}
          onChange={setFilters}
          categories={categoryOptions}
          paymentModes={paymentModeOptions}
          resultCount={result.expenses.length}
        />

        {isEmpty ? (
          <EmptyState
            icon={ChartPie}
            title="Nothing in this selection"
            body="Widen the period or clear a filter to see your spending."
          />
        ) : (
          <>
            {/* ── What stands out ──────────────────────────────────────── */}
            {result.insights.length > 0 && (
              <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
                <p className="inline-flex items-center gap-1.5 text-overline uppercase text-faint">
                  <Lightbulb className="h-3.5 w-3.5" />
                  What stands out
                </p>
                <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  {result.insights.map(insight => (
                    <li key={insight.id} className="flex gap-2.5 text-subhead min-w-0">
                      <span
                        className={cn(
                          'mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full',
                          insight.tone === 'up'
                            ? 'bg-destructive'
                            : insight.tone === 'down'
                              ? 'bg-positive'
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
              </section>
            )}

            {/* ── The numbers ──────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-card shadow-card p-5 min-w-0">
              <StatRow>
                {result.kpis.map(kpi => (
                  <Stat
                    key={kpi.label}
                    label={kpi.label}
                    value={kpi.format === 'currency' ? formatRounded(kpi.value) : Math.round(kpi.value)}
                    hint={
                      <span className="flex flex-wrap items-center gap-x-2">
                        <Delta value={kpi.delta} />
                        <span className="truncate">{kpi.hint}</span>
                      </span>
                    }
                  />
                ))}
              </StatRow>
            </div>

            {/* ── Where it went ────────────────────────────────────────── */}
            <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
              <SectionHeader
                title="Where the money went"
                subtitle="Income splits into what was kept and what was spent"
              />
              <SankeyFlow className="mt-5" expenses={result.expenses} income={flowIncome} />
            </section>

            {/* ── Trend ────────────────────────────────────────────────── */}
            <ChartCard
              title="Spending over time"
              subtitle={
                peak && peak.current > 0
                  ? `Per ${result.granularity} · peak ${peak.label} at ${formatRounded(peak.current)}`
                  : `Per ${result.granularity}`
              }
              action={
                <div className="flex items-center gap-3 text-caption text-muted-foreground">
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
              <div className="h-[260px] w-full min-w-0 sm:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={result.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.01} />
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
                      width={56}
                      tickFormatter={value => formatCompact(Number(value))}
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
                      strokeWidth={2.5}
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
              title="By category"
              subtitle={`${result.categories.length} categories · ranked by spend`}
              rows={result.categories}
              columns={[
                { header: 'Category', cell: r => r.category },
                { header: 'Spent', numeric: true, cell: r => formatAmount(r.amount) },
                { header: 'Share', numeric: true, cell: r => `${r.share.toFixed(1)}%` },
                { header: 'Payments', numeric: true, cell: r => r.transactions },
                { header: 'vs previous', numeric: true, cell: r => <Delta value={r.delta} className="justify-end" /> },
              ]}
            >
              <div className="w-full min-w-0" style={{ height: Math.max(200, categoryRows.length * 36 + 24) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categoryRows}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                    barCategoryGap={7}
                  >
                    <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={value => formatCompact(Number(value))}
                    />
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
                      cursor={{ fill: 'hsl(238 80% 62% / 0.06)' }}
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={value => [formatAmount(Number(value ?? 0)), 'Spent']}
                    />
                    {/* One hue per *category name*, so a category keeps its
                        colour across every chart on the page even as the
                        ranking shifts underneath it. */}
                    <Bar dataKey="amount" radius={[0, 5, 5, 0]} maxBarSize={20} isAnimationActive={false}>
                      {categoryRows.map(row => (
                        <Cell key={row.category} fill={colorForName(row.category)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 min-w-0">
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
                      <li key={slice.name} className="flex items-center gap-2.5 text-subhead min-w-0">
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: categoricalColor(i) }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{slice.name}</span>
                        <span className="ml-auto flex-shrink-0 tnum text-muted-foreground">
                          {formatMoney(slice.amount)}
                        </span>
                        <span className="w-12 flex-shrink-0 text-right tnum font-semibold">
                          {slice.share.toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>

                  {result.groups.length > 1 && (
                    <div className="border-t border-border pt-3">
                      <p className="text-overline uppercase text-faint mb-2">By type</p>
                      <ul className="space-y-1.5">
                        {result.groups.map(group => (
                          <li key={group.name} className="flex items-center gap-2 text-subhead">
                            <span className="text-muted-foreground">
                              {CATEGORY_GROUP_LABELS[group.name as CategoryGroup] ?? group.name}
                            </span>
                            <span className="ml-auto tnum">{formatMoney(group.amount)}</span>
                            <span className="w-12 text-right tnum font-semibold">
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
                        width={56}
                        tickFormatter={value => formatCompact(Number(value))}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(238 80% 62% / 0.06)' }}
                        contentStyle={TOOLTIP_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        formatter={value => [formatAmount(Number(value ?? 0)), 'Average']}
                      />
                      {/* Emphasis, not categorical: the heaviest day is the
                          point, the rest are context. */}
                      <Bar dataKey="average" radius={[5, 5, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                        {result.weekdays.map(day => (
                          <Cell
                            key={day.day}
                            fill={PRIMARY}
                            fillOpacity={busiestWeekday && day.day === busiestWeekday.day ? 1 : 0.28}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </div>

            {/* ── Largest single payments ──────────────────────────────── */}
            <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
              <SectionHeader title="Largest payments" subtitle="The biggest single entries in this period" />
              <ul className="mt-4 divide-y divide-border">
                {result.topExpenses.map(expense => (
                  <li key={expense._id} className="flex items-center gap-3 py-2.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: colorForName(expense.category) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-subhead font-medium">
                        {expense.description || expense.category}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {new Date(expense.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {' · '}
                        {expense.category}
                        {expense.paymentMode ? ` · ${expense.paymentMode}` : ''}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-subhead font-semibold tnum">
                      {formatMoney(expense.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
