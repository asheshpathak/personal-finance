import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import type { Projection } from '@/lib/forecast';

/**
 * The one number.
 *
 * Across every review corpus in this category, the single most praised feature
 * is a headline figure answering "how much can I spend right now" — Simplifi's
 * spending plan, PocketGuard's In My Pocket, Copilot's Free to Spend. It is the
 * only question people actually open a money app to ask, and answering it turns
 * a reporting tool into a decision-support one.
 *
 * Three choices make the number trustworthy rather than merely present:
 *
 *  · **Committed charges are subtracted once, not spread.** Subscriptions come
 *    out of what is left, and never enter the per-day rate. That removes the
 *    biggest source of day-to-day whiplash — rent posting and halving the
 *    allowance on a day the person did nothing.
 *  · **Today's share is weighted for the weekday it is.** A Saturday genuinely
 *    costs more than a Tuesday, and dividing flat makes the figure wrong in a
 *    way people notice every weekend.
 *  · **Pace, never pass/fail.** The bar shows spending against the calendar, so
 *    the state is "ahead" or "behind", not "over" or "failed". Binary red/green
 *    budgeting reliably produces a guilt cycle and disengagement; pace framing
 *    measurably retains better, and it is also simply more true — being 60% of
 *    the way through a budget is fine on day twenty and alarming on day five.
 */
export function SafeToSpend({
  projection,
  planned,
  className,
}: {
  projection: Projection;
  /** The active budget's total. Without one there is no allowance to compute. */
  planned: number | null;
  className?: string;
}) {
  const { formatParts, formatRounded } = useCurrency();

  // Without a plan there is no "safe to spend" — only "spent". Saying so, and
  // offering the one action that fixes it, beats inventing a number from thin
  // air and beats showing nothing.
  if (planned === null || planned <= 0 || !projection.live) {
    return (
      <NoPlanHero projection={projection} className={className} />
    );
  }

  const today = projection.safeToday ?? 0;
  const { symbol, digits } = formatParts(today);
  const headroom = planned - projection.spentToDate - projection.committedRemaining;
  const overspent = headroom <= 0;

  // How far through the money against how far through the calendar. The gap
  // between the two is the entire message.
  const spentPct = planned > 0 ? Math.min((projection.spentToDate / planned) * 100, 100) : 0;
  const elapsedPct = Math.min((projection.elapsedDays / projection.totalDays) * 100, 100);
  const ahead = spentPct - elapsedPct;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl bg-card border border-border shadow-card p-5 sm:p-7',
        className
      )}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-overline uppercase text-faint">
            {overspent ? 'Nothing left for today' : 'Safe to spend today'}
          </p>

          <p className="mt-2 flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-title-2 font-semibold',
                overspent ? 'text-destructive-text/70' : 'text-muted-foreground'
              )}
            >
              {symbol}
            </span>
            <span
              className={cn(
                'text-display tnum',
                overspent ? 'text-destructive-text' : 'text-foreground'
              )}
            >
              {overspent ? '0' : digits}
            </span>
          </p>

          <p className="mt-2 text-subhead text-muted-foreground">
            {overspent ? (
              <>
                The plan is spent, with {projection.remainingDays}{' '}
                {projection.remainingDays === 1 ? 'day' : 'days'} to go.
              </>
            ) : (
              <>
                {formatRounded(headroom)} left across {projection.remainingDays}{' '}
                {projection.remainingDays === 1 ? 'day' : 'days'}
                {projection.committedRemaining > 0 && (
                  <>
                    , after {formatRounded(projection.committedRemaining)} of bills
                  </>
                )}
                .
              </>
            )}
          </p>
        </div>

        {/* The projection, as a secondary figure. It answers the next question
            — "and where does that leave the month" — without competing with the
            headline for attention. */}
        <div className="flex-shrink-0 sm:text-right">
          <p className="text-overline uppercase text-faint">On pace to finish</p>
          <p className="mt-1.5 text-title-2 tnum">{formatRounded(projection.expected)}</p>
          <p className="text-caption text-muted-foreground tnum">
            of {formatRounded(planned)} planned
          </p>
        </div>
      </div>

      {/* ── Pace ───────────────────────────────────────────────────────────
          One track, two marks: the fill is the money, the notch is the
          calendar. Two bars side by side would make the reader do the
          subtraction; one track turns it into a glance. */}
      <div className="mt-6">
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-spring',
              // Overspent first: a plan that is already gone is not merely
              // "running ahead", and the softer colour would understate it.
              overspent ? 'bg-destructive' : ahead > 10 ? 'bg-warning' : 'bg-primary'
            )}
            style={{ width: `${spentPct}%` }}
          />
          <span
            className="absolute inset-y-[-3px] w-[3px] rounded-full bg-foreground/70"
            style={{ left: `calc(${elapsedPct}% - 1.5px)` }}
            aria-hidden="true"
            title="Where the calendar is"
          />
        </div>

        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-muted-foreground">
          <span className="tnum">
            {Math.round(spentPct)}% spent · {Math.round(elapsedPct)}% of the period gone
          </span>
          {Math.abs(ahead) > 8 && (
            <span
              className={cn(
                'font-semibold',
                ahead > 0 ? 'text-warning-text' : 'text-positive-text'
              )}
            >
              {ahead > 0 ? 'running ahead' : 'comfortably under'}
            </span>
          )}
        </p>
      </div>

      {/* Honesty about the estimate. Early in a period the figure leans on
          history rather than on this month, and saying so is what stops the
          number being quietly disbelieved later. */}
      {projection.confidence < 0.45 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2.5 text-footnote text-muted-foreground">
          <Info className="mt-[3px] h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">
            Early in the period, so this leans on your history more than on this month.
            It sharpens as the days go by.
          </span>
        </p>
      )}
    </section>
  );
}

/** The state before a budget exists. Names the gap and offers the fix. */
function NoPlanHero({ projection, className }: { projection: Projection; className?: string }) {
  const { formatParts, formatRounded } = useCurrency();
  const { symbol, digits } = formatParts(projection.spentToDate);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card shadow-card p-5 sm:p-7',
        className
      )}
    >
      <p className="text-overline uppercase text-faint">Spent this period</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-title-2 font-semibold text-muted-foreground">{symbol}</span>
        <span className="text-display tnum">{digits}</span>
      </p>

      {projection.live && projection.reliable && (
        <p className="mt-2 text-subhead text-muted-foreground">
          On pace to finish around{' '}
          <span className="font-semibold text-foreground tnum">
            {formatRounded(projection.expected)}
          </span>{' '}
          — between {formatRounded(projection.low)} and {formatRounded(projection.high)}.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2.5 rounded-xl bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-footnote text-muted-foreground">
          <CalendarDays className="mt-[2px] h-4 w-4 flex-shrink-0" />
          <span className="min-w-0">
            Set a budget and this becomes a daily allowance instead of a running total.
          </span>
        </p>
        <Link
          to="/budgets/new"
          className="tactile inline-flex h-10 flex-shrink-0 items-center gap-1.5 self-start rounded-full bg-primary px-4 text-footnote font-semibold text-primary-foreground sm:self-auto"
        >
          Plan a period
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
