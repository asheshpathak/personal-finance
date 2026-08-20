import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, CalendarClock, Target, TrendingUp } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { SegmentedTrack } from '@/components/ui/segmented';
import { useCurrency } from '@/context/CurrencyContext';
import { useFinances } from '@/lib/useFinances';
import { computeBudgetUtilization, periodDays } from '@/lib/budgetSections';
import {
  categoryOutlook,
  dailyTotals,
  projectPeriod,
  typicalMonthly,
  type ForecastExpense,
  type Projection,
} from '@/lib/forecast';
import { scheduledCharges } from '@/lib/subscriptionSchedule';
import {
  addDays,
  endOfMonth,
  formatDay,
  fromDayKey,
  startOfMonth,
  toDayKey,
} from '@/lib/dates';
import {
  AXIS_TEXT,
  GRID,
  PRIMARY,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
} from '@/lib/chartTheme';
import { cn } from '@/lib/utils';

/**
 * Where this period lands.
 *
 * Every other screen in the app looks backwards. This one is the only one that
 * looks forward, and that is the point — a pie chart of last month is a museum
 * exhibit, while a projection is something a person can still act on. The apps
 * that keep people tell them what to do, not what happened.
 *
 * The headline is a **band**, not a point. A single projected figure is a
 * promise the maths cannot keep: spending is bursty and the honest answer is a
 * range. Showing the range is also what makes the centre believable.
 */
export default function Plan() {
  const { formatAmount, formatMoney, formatRounded, formatCompact } = useCurrency();
  const { expenses, subscriptions, budgets, activeBudget, loading, ready } = useFinances();

  const [horizon, setHorizon] = useState<'period' | '90d'>('period');
  const today = toDayKey();

  const period = useMemo(() => {
    if (activeBudget) {
      return {
        start: new Date(activeBudget.startDate).toISOString().slice(0, 10),
        end: new Date(activeBudget.endDate).toISOString().slice(0, 10),
      };
    }
    const now = fromDayKey(today);
    return { start: toDayKey(startOfMonth(now)), end: toDayKey(endOfMonth(now)) };
  }, [activeBudget, today]);

  const utilization = useMemo(
    () => (activeBudget ? computeBudgetUtilization(activeBudget, expenses) : null),
    [activeBudget, expenses]
  );

  const planned = utilization?.totals.allocated ?? null;

  const projection = useMemo(
    () =>
      projectPeriod({
        expenses,
        subscriptions,
        startDay: period.start,
        endDay: period.end,
        today,
        ...(planned !== null && planned > 0 ? { planned } : {}),
        seed: activeBudget?._id ?? period.start,
      }),
    [expenses, subscriptions, period, today, planned, activeBudget]
  );

  const history = useMemo(() => typicalMonthly(expenses, 6, today), [expenses, today]);

  const outlook = useMemo(() => {
    const plan = utilization
      ? utilization.sections.flatMap(section =>
          section.items.map(item => ({ category: item.category, planned: item.allocated }))
        )
      : [];
    return categoryOutlook(projection, expenses, plan, history).slice(0, 12);
  }, [projection, expenses, utilization, history]);

  /** The cumulative curve: what has happened, then where it is heading. */
  const curve = useMemo(
    () => buildCurve(projection, expenses, subscriptions, period),
    [projection, expenses, subscriptions, period]
  );

  /** Everything scheduled over the next ninety days, for the bills view. */
  const ahead = useMemo(
    () =>
      scheduledCharges(
        subscriptions,
        toDayKey(addDays(fromDayKey(today), 1)),
        toDayKey(addDays(fromDayKey(today), 90))
      ),
    [subscriptions, today]
  );

  const shown = horizon === 'period' ? projection.upcoming : ahead;
  const shownTotal = shown.reduce((total, charge) => total + charge.amount, 0);

  if (loading && !ready) {
    return (
      <Layout title="Plan">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  if (!projection.reliable) {
    return (
      <Layout title="Plan">
        <PageHeader
          title="Plan"
          lede="Where this period lands, and what is already committed."
        />
        <EmptyState
          className="mt-6"
          icon={TrendingUp}
          title="Not enough history to forecast yet"
          body="A projection needs a few weeks of recorded payments behind it. Until then, showing you a number would be inventing one."
          action={
            <Button asChild variant="tinted">
              <Link to="/expenses">See what is recorded</Link>
            </Button>
          }
        />
      </Layout>
    );
  }

  return (
    <Layout title="Plan">
      <div className="flex flex-col gap-5 sm:gap-6 min-w-0">
        <PageHeader
          title="Plan"
          lede={
            <>
              {formatDay(fromDayKey(period.start), { year: undefined })} –{' '}
              {formatDay(fromDayKey(period.end))} ·{' '}
              {periodDays(period.start, period.end)} days
              {activeBudget ? '' : ' · no active budget'}
            </>
          }
          action={
            budgets.length === 0 ? (
              <Button asChild>
                <Link to="/budgets/new">Create a budget</Link>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link to="/budgets">
                  Budgets
                  <ArrowRight />
                </Link>
              </Button>
            )
          }
        />

        {/* ── The projection ───────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-7 min-w-0">
          <p className="text-overline uppercase text-faint">
            {projection.live ? 'On pace to finish at' : 'Finished at'}
          </p>

          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <p className="text-display tnum">{formatRounded(projection.expected)}</p>

            {planned !== null && planned > 0 && (
              <div className="text-right">
                <p className="text-overline uppercase text-faint">Against plan</p>
                <p
                  className={cn(
                    'mt-1 text-title-3 tnum',
                    projection.expected > planned ? 'text-destructive-text' : 'text-positive-text'
                  )}
                >
                  {projection.expected > planned ? '+' : '−'}
                  {formatRounded(Math.abs(projection.expected - planned))}
                </p>
              </div>
            )}
          </div>

          {/* The band. Not decoration — the width of it is the honest content
              of a forecast, and a single number would be a claim the data
              cannot support. */}
          <div className="mt-5">
            <div className="relative h-10">
              <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-muted" />
              <div
                className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-primary/25"
                style={{
                  left: `${bandPosition(projection.low, projection)}%`,
                  width: `${Math.max(
                    bandPosition(projection.high, projection) - bandPosition(projection.low, projection),
                    2
                  )}%`,
                }}
              />
              <span
                className="absolute top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-primary"
                style={{ left: `calc(${bandPosition(projection.expected, projection)}% - 1.5px)` }}
                aria-hidden="true"
              />
              {planned !== null && planned > 0 && (
                <span
                  className="absolute top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full bg-foreground/50"
                  style={{ left: `calc(${bandPosition(planned, projection)}% - 1px)` }}
                  aria-hidden="true"
                  title="Planned"
                />
              )}
            </div>

            <div className="flex items-center justify-between text-caption text-muted-foreground tnum">
              <span>{formatCompact(projection.low)}</span>
              <span className="text-faint">most likely between</span>
              <span>{formatCompact(projection.high)}</span>
            </div>
          </div>

          {/* ── The read-out ──────────────────────────────────────────── */}
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <Figure
              label="Spent so far"
              value={formatRounded(projection.spentToDate)}
              hint={`${projection.elapsedDays} of ${projection.totalDays} days`}
            />
            <Figure
              label="Committed"
              value={formatRounded(projection.committedRemaining)}
              hint={`${projection.upcoming.length} ${projection.upcoming.length === 1 ? 'charge' : 'charges'} ahead`}
            />
            <Figure
              label="Per day"
              value={formatRounded(projection.dailyRate)}
              hint="on the days ahead"
            />
            {projection.riskOfOverrun !== null ? (
              <Figure
                label="Risk of overrun"
                value={`${Math.round(projection.riskOfOverrun * 100)}%`}
                hint="across 2,000 simulations"
                tone={projection.riskOfOverrun > 0.6 ? 'bad' : projection.riskOfOverrun > 0.3 ? 'warn' : 'good'}
              />
            ) : (
              <Figure
                label="Days left"
                value={String(projection.remainingDays)}
                hint="including today"
              />
            )}
          </div>

          {projection.safeDailySpend !== null && projection.safeDailySpend > 0 && (
            <p className="mt-5 flex items-start gap-2.5 rounded-xl bg-primary-tint px-4 py-3 text-footnote">
              <Target className="mt-[2px] h-4 w-4 flex-shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="font-semibold text-primary tnum">
                  {formatRounded(projection.safeDailySpend)} a day
                </span>{' '}
                <span className="text-muted-foreground">
                  over the remaining {projection.remainingDays}{' '}
                  {projection.remainingDays === 1 ? 'day' : 'days'} finishes exactly on plan.
                  Weekends get a little more than weekdays.
                </span>
              </span>
            </p>
          )}

          {projection.riskOfOverrun !== null && projection.riskOfOverrun > 0.6 && (
            <p className="mt-3 flex items-start gap-2.5 rounded-xl bg-destructive-tint px-4 py-3 text-footnote">
              <AlertTriangle className="mt-[2px] h-4 w-4 flex-shrink-0 text-destructive-text" />
              <span className="min-w-0 text-muted-foreground">
                At this rate the plan is beaten in{' '}
                <span className="font-semibold text-destructive-text">
                  {Math.round(projection.riskOfOverrun * 100)}%
                </span>{' '}
                of simulated months. Cutting{' '}
                <span className="font-semibold text-foreground tnum">
                  {formatRounded((projection.expected - (planned ?? 0)) / Math.max(projection.remainingDays, 1))}
                </span>{' '}
                a day would close the gap.
              </span>
            </p>
          )}
        </section>

        {/* ── The curve ────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
          <SectionHeader
            title="How it accumulates"
            subtitle="Recorded so far, then the projected path"
          />

          <div className="mt-4 h-[240px] w-full min-w-0 sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="planFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={28}
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
                {planned !== null && planned > 0 && (
                  <ReferenceLine
                    y={planned}
                    stroke="hsl(240 8% 9% / 0.45)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Recorded"
                  stroke={PRIMARY}
                  strokeWidth={2.5}
                  fill="url(#planFill)"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {/* Dashed, because it has not happened. A solid continuation
                    would make a projection look like a measurement. */}
                <Line
                  type="monotone"
                  dataKey="projected"
                  name="Projected"
                  stroke={PRIMARY}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── Where each line lands ────────────────────────────────────── */}
        {outlook.length > 0 && (
          <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
            <SectionHeader
              title="Where each line lands"
              subtitle="Projected to the end of the period, worst variance first"
            />

            <ul className="mt-4 divide-y divide-border">
              {outlook.map(row => {
                const over = row.planned > 0 && row.projected > row.planned;
                const ceiling = Math.max(row.planned, row.projected, 1);
                return (
                  <li key={row.category} className="py-3 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-subhead font-medium">
                        {row.category}
                      </span>
                      {row.basis === 'history' && (
                        <Badge tone="neutral" size="sm" className="flex-shrink-0">
                          from history
                        </Badge>
                      )}
                      <span className="flex-shrink-0 text-subhead font-semibold tnum">
                        {formatRounded(row.projected)}
                      </span>
                    </div>

                    <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full',
                          over ? 'bg-destructive' : 'bg-primary'
                        )}
                        style={{ width: `${Math.min((row.projected / ceiling) * 100, 100)}%` }}
                      />
                      {row.planned > 0 && (
                        <span
                          className="absolute inset-y-[-2px] w-[2px] rounded-full bg-foreground/60"
                          style={{ left: `calc(${(row.planned / ceiling) * 100}% - 1px)` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>

                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground tnum">
                      <span>{formatRounded(row.spent)} so far</span>
                      {row.planned > 0 && (
                        <>
                          <span className="text-faint">·</span>
                          <span>{formatRounded(row.planned)} planned</span>
                          <span
                            className={cn(
                              'font-semibold',
                              over ? 'text-destructive-text' : 'text-positive-text'
                            )}
                          >
                            {over ? '+' : '−'}
                            {formatRounded(Math.abs(row.variance))}
                          </span>
                        </>
                      )}
                      {row.planned === 0 && <span className="text-warning-text font-semibold">not planned</span>}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── Bills ahead ──────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0">
          <SectionHeader
            title="Already committed"
            subtitle={
              <span className="tnum">
                {formatRounded(shownTotal)} across {shown.length}{' '}
                {shown.length === 1 ? 'charge' : 'charges'}
              </span>
            }
            action={
              <SegmentedTrack
                ariaLabel="Horizon"
                value={horizon}
                onChange={setHorizon}
                options={[
                  { value: 'period', label: 'This period' },
                  { value: '90d', label: '90 days' },
                ]}
              />
            }
          />

          {shown.length === 0 ? (
            <p className="py-8 text-center text-subhead text-muted-foreground">
              Nothing scheduled in this window.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {shown.slice(0, 20).map(charge => (
                <li
                  key={`${charge.subscriptionId ?? charge.name}-${charge.day}`}
                  className="flex items-center gap-3 py-2.5 min-w-0"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.65rem] bg-muted text-muted-foreground">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-subhead font-medium">{charge.name}</span>
                    <span className="block text-caption text-muted-foreground">
                      {charge.category}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className="block text-subhead font-semibold tnum">
                      {formatMoney(charge.amount)}
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {formatDay(fromDayKey(charge.day), { year: undefined })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}

function Figure({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-overline uppercase text-faint">{label}</p>
      <p
        className={cn(
          'mt-1.5 text-title-3 tnum',
          tone === 'bad' && 'text-destructive-text',
          tone === 'warn' && 'text-warning-text',
          tone === 'good' && 'text-positive-text'
        )}
      >
        {value}
      </p>
      <p className="truncate text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Positions a figure on the band's axis.
 *
 * The axis is padded past both ends of the band so the marks never sit flush
 * against the edge, and clamped so a plan far outside the projection still
 * renders somewhere sensible rather than off the track entirely.
 */
function bandPosition(value: number, projection: Projection): number {
  const span = Math.max(projection.high - projection.low, 1);
  const min = projection.low - span * 0.35;
  const max = projection.high + span * 0.35;
  // Clamped to 1–99 rather than 0–100: a mark flush against the track's end is
  // half-clipped by the rounded cap, which reads as a rendering bug rather than
  // as "this figure is off the scale".
  return Math.min(Math.max(((value - min) / (max - min)) * 100, 1), 99);
}

interface CurvePoint {
  label: string;
  /** Cumulative recorded spend. Null after today, so the line stops. */
  actual: number | null;
  /** The projected path. Null before today, so the two meet exactly once. */
  projected: number | null;
}

/**
 * The cumulative curve.
 *
 * Actual and projected are separate series that share exactly one point —
 * today. Overlapping them at the join is what makes the dashed line read as a
 * continuation of the solid one rather than as a second, unrelated series.
 */
function buildCurve(
  projection: Projection,
  expenses: ForecastExpense[],
  subscriptions: Parameters<typeof scheduledCharges>[0],
  period: { start: string; end: string }
): CurvePoint[] {
  const daily = dailyTotals(expenses, period.start, period.end);

  // Committed charges land on the day they are due, so the projected line steps
  // where a bill falls rather than rising smoothly through it.
  const committed = new Map<string, number>();
  for (const charge of scheduledCharges(subscriptions, projection.today, period.end)) {
    committed.set(charge.day, (committed.get(charge.day) ?? 0) + charge.amount);
  }

  const points: CurvePoint[] = [];
  let running = 0;
  let projected = 0;
  let started = false;

  for (
    let day = fromDayKey(period.start), end = fromDayKey(period.end);
    day <= end;
    day = addDays(day, 1)
  ) {
    const key = toDayKey(day);
    const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (key <= projection.today) {
      running += daily.get(key) ?? 0;
      points.push({
        label,
        actual: running,
        // The join: today carries both, so the series connect.
        projected: key === projection.today ? running : null,
      });
      projected = running;
      started = true;
    } else {
      projected += projection.dailyRate + (committed.get(key) ?? 0);
      points.push({ label, actual: null, projected: started ? projected : null });
    }
  }

  return points;
}
