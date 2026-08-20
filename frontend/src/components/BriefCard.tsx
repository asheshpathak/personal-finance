import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import {
  aiStatus,
  fetchBrief,
  fetchBriefFreshness,
  type Brief,
  type BriefInsight,
  type BriefPace,
  type BriefStanding,
} from '@/lib/ai';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/section';

/**
 * Today's read.
 *
 * The app's own statistics already produce numbers. What they cannot do is
 * decide which of forty true facts is worth a person's attention this morning,
 * and that judgement is the only reason this exists. The prompt behind it is
 * written almost entirely as a list of prohibitions, because the default
 * failure of an AI money feature is not being wrong — it is being insufferable.
 *
 * **It is a fact about a day.** The server writes it once, on the first visit
 * after midnight in the reader's own timezone, and serves the same words for
 * the rest of it. That is what makes it worth reading at all: a card that
 * reworded itself on every page load taught people to skip it, and a
 * comparison like "you are ahead of where you usually are by the 20th" needs a
 * fixed vantage point to mean anything.
 *
 * It loads by itself rather than waiting for a button, because a cached answer
 * costs nothing and an insight nobody clicked for is an insight nobody read.
 */

const TONE: Record<BriefInsight['tone'], { icon: LucideIcon; ring: string; chip: string }> = {
  good: { icon: TrendingUp, ring: 'bg-positive-tint text-positive-text', chip: 'text-positive-text' },
  watch: { icon: Eye, ring: 'bg-warning-tint text-warning-text', chip: 'text-warning-text' },
  risk: { icon: AlertTriangle, ring: 'bg-destructive-tint text-destructive-text', chip: 'text-destructive-text' },
  neutral: { icon: Sparkles, ring: 'bg-muted text-muted-foreground', chip: 'text-muted-foreground' },
};

const STANDING: Record<BriefStanding['tone'], { label: string; badge: 'positive' | 'neutral' | 'warning' | 'negative' }> = {
  strong: { label: 'Comfortable', badge: 'positive' },
  steady: { label: 'Steady', badge: 'neutral' },
  tight: { label: 'Tight', badge: 'warning' },
  strained: { label: 'Under strain', badge: 'negative' },
};

/**
 * The pace row.
 *
 * Spending is the subject, so *less* is the good direction — "ahead" means
 * ahead of the game, not ahead on spending, and the arrow points down. Getting
 * that backwards is the classic way a finance dashboard congratulates someone
 * for a bad month.
 */
const PACE: Record<BriefPace['status'], { label: string; icon: LucideIcon; className: string }> = {
  ahead: { label: 'Ahead', icon: TrendingDown, className: 'text-positive-text' },
  'on-track': { label: 'On track', icon: Gauge, className: 'text-muted-foreground' },
  behind: { label: 'Running hot', icon: TrendingUp, className: 'text-warning-text' },
  'too-early': { label: 'Too early to say', icon: Gauge, className: 'text-faint' },
};

/**
 * Session-scoped, on top of the server's per-day cache.
 *
 * Saves a round-trip when navigating back to the dashboard. The server is still
 * the authority on what today's briefing says; this only avoids asking twice in
 * the same minute.
 */
let cached: Brief | null = null;

export function BriefCard({ className }: { className?: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [brief, setBrief] = useState<Brief | null>(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataMoved, setDataMoved] = useState(false);
  const [refreshesLeft, setRefreshesLeft] = useState<number | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchBrief(refresh);
      cached = next;
      setBrief(next);
      setDataMoved(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't read your data just now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void aiStatus().then(status => {
      if (cancelled) return;
      setAvailable(status.configured);
      // Auto-load only where the feature exists. The first call of the day
      // writes the briefing; every one after it is served from storage.
      if (status.configured && !cached) void load();
    });

    return () => { cancelled = true; };
  }, [load]);

  // Whether the ground has moved since the briefing was written. Costs a
  // database read and no tokens, so it is worth asking on every mount.
  useEffect(() => {
    if (!brief || brief.sparse) return;
    let cancelled = false;
    fetchBriefFreshness()
      .then(freshness => {
        if (cancelled) return;
        setDataMoved(freshness.changed);
        setRefreshesLeft(freshness.regenerationsLeft);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [brief]);

  // Nothing renders at all where the server has no key. A dead feature visible
  // in the interface is worse than an absent one.
  if (available === false) return null;

  const standing = brief?.standing ? STANDING[brief.standing.tone] : null;
  const canRefresh = refreshesLeft === null || refreshesLeft > 0;

  return (
    <section
      className={cn('rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0', className)}
      aria-labelledby="brief-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] bg-pop-tint text-pop">
            <Sparkles className="h-[1.05rem] w-[1.05rem]" />
          </span>
          <div className="min-w-0">
            <h2 id="brief-heading" className="flex flex-wrap items-center gap-2 text-headline">
              Today's read
              {standing && (
                <Badge tone={standing.badge} size="sm">{standing.label}</Badge>
              )}
            </h2>
            <p className="text-footnote text-muted-foreground">
              Written this morning from your own history. It says the same thing all day.
            </p>
          </div>
        </div>

        {brief && !brief.sparse && (
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || !canRefresh}
            aria-label={canRefresh ? 'Read it again' : 'No more fresh reads left today'}
            title={canRefresh ? 'Read it again' : 'No more fresh reads left today'}
            className="tactile flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-faint hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* ── Working ──────────────────────────────────────────────────────── */}
      {loading && !brief && (
        <div className="mt-5 space-y-3" aria-live="polite" aria-busy="true">
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <span className="sr-only">Reading your spending…</span>
        </div>
      )}

      {error && !brief && (
        <div className="mt-5">
          <p role="alert" className="text-footnote text-destructive-text">{error}</p>
          <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => void load()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      )}

      {/* ── The briefing ─────────────────────────────────────────────────── */}
      {brief && (
        <div className={cn('mt-5 min-w-0', loading && 'opacity-50 transition-opacity')}>
          <p className="text-title-3 text-balance">{brief.headline}</p>

          {brief.sparse ? (
            <p className="mt-2 text-subhead text-muted-foreground">
              Record a few more payments and there will be something worth saying here.
            </p>
          ) : (
            <>
              {/* Where they stand — the part most people read and nothing else. */}
              {brief.standing && (
                <p className="mt-2.5 text-subhead text-muted-foreground">{brief.standing.summary}</p>
              )}

              {/* This month against a normal one, at the same point in it. */}
              {brief.pace && brief.pace.status !== 'too-early' && (
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-subtle p-3.5 min-w-0">
                  <span className={cn('mt-0.5 flex-shrink-0', PACE[brief.pace.status].className)}>
                    {(() => {
                      const Icon = PACE[brief.pace.status].icon;
                      return <Icon className="h-4 w-4" />;
                    })()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={cn('text-subhead font-semibold', PACE[brief.pace.status].className)}>
                        {PACE[brief.pace.status].label}
                      </p>
                      <span className="flex-shrink-0 text-subhead font-bold tnum">{brief.pace.metric}</span>
                    </div>
                    <p className="mt-0.5 text-footnote text-muted-foreground">{brief.pace.detail}</p>
                  </div>
                </div>
              )}

              <ul className="mt-3 space-y-2.5">
                {brief.insights.map((insight, index) => {
                  const tone = TONE[insight.tone];
                  return (
                    <li key={`${insight.title}-${index}`} className="flex gap-3 rounded-xl bg-subtle p-3.5 min-w-0">
                      <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', tone.ring)}>
                        <tone.icon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 text-subhead font-semibold">{insight.title}</p>
                          <span className={cn('flex-shrink-0 text-subhead font-bold tnum', tone.chip)}>
                            {insight.metric}
                          </span>
                        </div>
                        <p className="mt-0.5 text-footnote text-muted-foreground">{insight.detail}</p>
                        {insight.action && (
                          <p className="mt-1.5 text-footnote font-medium text-primary">{insight.action}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/*
                The ground moved. Said rather than acted on: quietly rewriting
                the morning's briefing at lunchtime is exactly the behaviour the
                daily cache exists to prevent, so the choice stays with the
                reader.
              */}
              {dataMoved && canRefresh && !loading && (
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="tactile mt-3 flex w-full items-center gap-2 rounded-xl bg-info-tint px-3.5 py-3 text-left text-footnote text-info-text"
                >
                  <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0">
                    You have recorded more since this was written. Read it again?
                  </span>
                </button>
              )}

              {brief.stale && (
                <p className="mt-3 text-caption text-muted-foreground">
                  Couldn't reach the model just now, so this is the last briefing that was written.
                </p>
              )}
            </>
          )}

          {loading && brief && (
            <p className="mt-3 flex items-center gap-2 text-footnote text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Looking again…
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 text-footnote text-destructive-text">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}
