import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Eye,
  EyeOff,
  Pause,
  Play,
  Share2,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { PageHeader, EmptyState } from '@/components/ui/section';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented';
import { Stat, StatRow } from '@/components/ui/stat';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { useFinances } from '@/lib/useFinances';
import { usePrefersReducedMotion } from '@/lib/useMediaQuery';
import { buildRecap, recappableMonths, type RecapSlide } from '@/lib/recap';
import { toDayKey } from '@/lib/dates';

/**
 * The month in review.
 *
 * A period boundary is the one moment someone is willing to look *back* at
 * their spending rather than at it, and a stack of slides is the format that
 * has been proven to carry that. The structure is Spotify Wrapped's; so are the
 * rules that keep it from feeling like a report.
 *
 * Two are worth calling out because they are counter-intuitive:
 *
 *  · **Monthly, not yearly.** A yearly recap gives one feedback loop a year.
 *    Twelve is worth more than one, and a month is recent enough that the
 *    reader remembers the payments being described.
 *  · **Amounts hide.** Absolute figures are the part of this nobody can share,
 *    and every slide here also states itself in shares, counts and ranks. Turn
 *    the amounts off and there is still something worth reading — which is the
 *    difference between a recap and a statement.
 */

/**
 * One tint per slide, cycled.
 *
 * Saturated enough to read as an editorial card rather than as another content
 * surface — this is the one place in the app where a coloured background is
 * correct, because the slide *is* the thing rather than a container for it. The
 * eyebrow takes the same hue at full strength so the card has a point of
 * emphasis that isn't the headline.
 */
const ACCENT = [
  { surface: 'bg-chart-1/[0.10]', ink: 'text-chart-1' },
  { surface: 'bg-chart-2/[0.10]', ink: 'text-chart-2' },
  { surface: 'bg-chart-7/[0.10]', ink: 'text-chart-7' },
  { surface: 'bg-chart-3/[0.10]', ink: 'text-chart-3' },
  { surface: 'bg-chart-5/[0.10]', ink: 'text-chart-5' },
  { surface: 'bg-chart-4/[0.10]', ink: 'text-chart-4' },
] as const;

/** How long a slide holds before advancing. Long enough to read one claim. */
const DWELL_MS = 5200;

export default function Recap() {
  const { formatAmount, formatRounded } = useCurrency();
  const { expenses, loading, ready } = useFinances({ budgets: false, subscriptions: false });
  const reducedMotion = usePrefersReducedMotion();

  const today = toDayKey();
  const months = useMemo(() => recappableMonths(expenses, today), [expenses, today]);

  const [month, setMonth] = useState<string>('');

  // Open on the most recent recappable month, once the data is in. Adjusted
  // during render rather than in an effect, so the empty state is never painted
  // for a frame before the first month is chosen.
  if (!month && months.length > 0) setMonth(months[0]!);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showAmounts, setShowAmounts] = useState(true);
  const [shared, setShared] = useState(false);

  const recap = useMemo(
    () => (month ? buildRecap(expenses, { month, money: formatAmount, today }) : null),
    [expenses, month, formatAmount, today]
  );

  const slides = recap?.slides ?? [];
  const slide = slides[index];

  // Changing month restarts the sequence. Adjusted during render rather than in
  // an effect, so the old month's slide is never briefly shown under the new
  // month's label.
  const [lastMonth, setLastMonth] = useState(month);
  if (lastMonth !== month) {
    setLastMonth(month);
    setIndex(0);
  }

  const next = useCallback(() => {
    setIndex(current => {
      if (current >= slides.length - 1) {
        setPlaying(false);
        return current;
      }
      return current + 1;
    });
  }, [slides.length]);

  const previous = useCallback(() => setIndex(current => Math.max(current - 1, 0)), []);

  // Auto-advance. Reduced motion disables it entirely rather than shortening
  // it: an interface that moves by itself is precisely what that setting is
  // asking not to happen.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!playing || reducedMotion || slides.length === 0) return;
    timer.current = window.setTimeout(next, DWELL_MS);
    return () => window.clearTimeout(timer.current);
  }, [playing, index, next, reducedMotion, slides.length]);

  // Arrow keys, because a slideshow that ignores them is a slideshow nobody
  // uses on a laptop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
      else if (event.key === ' ') {
        event.preventDefault();
        setPlaying(p => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, previous]);

  const share = async () => {
    if (!slide || !recap) return;
    const text = `${recap.label} — ${slide.headline}. ${slide.shareable}`;

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `Tetra · ${recap.label}`, text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // A cancelled share sheet rejects. That is not an error worth reporting.
    }
  };

  if (loading && !ready) {
    return (
      <Layout title="Recap">
        <div className="h-[70dvh] shimmer rounded-2xl" />
      </Layout>
    );
  }

  if (months.length === 0 || !recap || slides.length === 0) {
    return (
      <Layout title="Recap">
        <PageHeader title="Recap" lede="Your month, in slides." />
        <EmptyState
          className="mt-6"
          icon={Clapperboard}
          title="No month worth recapping yet"
          body="A recap needs a complete month with at least a dozen payments in it. Suppressing it beats padding one out."
        />
      </Layout>
    );
  }

  return (
    <Layout title="Recap">
      <div className="flex flex-col gap-4 min-w-0">
        <PageHeader title="Recap" lede={recap.label} />

        {months.length > 1 && (
          <SegmentedControl
            ariaLabel="Month"
            size="sm"
            value={month}
            onChange={setMonth}
            options={months.slice(0, 12).map(key => ({
              value: key,
              label: new Date(`${key}-02T12:00:00`).toLocaleDateString('en-US', {
                month: 'short',
                year: '2-digit',
              }),
            }))}
          />
        )}

        {/* ── Progress ─────────────────────────────────────────────────── */}
        <div className="flex gap-1" role="tablist" aria-label="Slides">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}`}
              onClick={() => { setIndex(i); setPlaying(false); }}
              // The bar stays 4px; the button around it is 44px. A progress dot
              // is a small mark and a large target, never both at once.
              className="group flex h-11 flex-1 min-w-0 items-center"
            >
              <span
                className={cn(
                  'block h-1 w-full rounded-full transition-colors duration-300',
                  i < index ? 'bg-foreground/40' : i === index ? 'bg-foreground' : 'bg-border'
                )}
              />
            </button>
          ))}
        </div>

        {/* ── The slide ────────────────────────────────────────────────── */}
        <section
          className={cn(
            'relative flex min-h-[26rem] cursor-pointer flex-col overflow-hidden rounded-[1.75rem] p-6 sm:min-h-[30rem] sm:p-10',
            ACCENT[slide?.accent ?? 0]!.surface
          )}
          // Tap left/right halves to move, the way every story UI works.
          onClick={event => {
            const { left, width } = event.currentTarget.getBoundingClientRect();
            const fraction = (event.clientX - left) / width;
            setPlaying(false);
            if (fraction < 0.32) previous();
            else if (fraction > 0.68) next();
          }}
        >
          {slide && (
            // Keyed on the index so React remounts and replays the entrance.
            <div key={index} className="animate-rise flex flex-1 flex-col">
              <p className={cn('text-overline uppercase', ACCENT[slide.accent]!.ink)}>
                {slide.eyebrow}
              </p>

              {/* The text block sits at the foot of the card, App Store
                  editorial style. Centring it leaves two dead bands and makes
                  the claim look like a caption rather than the point. */}
              <div className="mt-auto pt-10">
                {slide.value && showAmounts && (
                  <p className="text-display tnum leading-[0.95]">{slide.value}</p>
                )}
                <h2
                  className={cn(
                    'text-balance',
                    slide.value && showAmounts
                      ? 'mt-3 text-title-2 sm:text-title-1'
                      : 'text-title-1 sm:text-display'
                  )}
                >
                  {slide.headline}
                </h2>
                <p className="mt-3 max-w-lg text-callout text-muted-foreground">
                  {showAmounts ? slide.detail : slide.shareable}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Controls ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={previous}
            disabled={index === 0}
            aria-label="Previous slide"
          >
            <ChevronLeft />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setPlaying(p => !p)}
            aria-label={playing ? 'Pause' : 'Play'}
            disabled={reducedMotion}
            title={reducedMotion ? 'Auto-advance is off while reduced motion is on' : undefined}
          >
            {playing ? <Pause /> : <Play />}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={next}
            disabled={index >= slides.length - 1}
            aria-label="Next slide"
          >
            <ChevronRight />
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAmounts(v => !v)}
              aria-pressed={!showAmounts}
            >
              {showAmounts ? <Eye /> : <EyeOff />}
              <span className="hidden sm:inline">{showAmounts ? 'Amounts on' : 'Amounts hidden'}</span>
            </Button>

            <Button variant="tinted" size="sm" onClick={() => void share()}>
              <Share2 />
              {shared ? 'Copied' : 'Share'}
            </Button>
          </div>
        </div>

        {/* ── The month in one line ────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <StatRow>
            <Stat
              label="Spent"
              value={showAmounts ? formatRounded(recap.totals.spent) : '—'}
              hint={recap.label}
            />
            <Stat label="Payments" value={String(recap.totals.payments)} hint="recorded" />
            <Stat label="Categories" value={String(recap.totals.categories)} hint="touched" />
          </StatRow>
        </div>
      </div>
    </Layout>
  );
}

export type { RecapSlide };
