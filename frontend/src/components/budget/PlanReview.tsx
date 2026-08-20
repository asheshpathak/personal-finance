import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { aiStatus, reviewPlan, type PlanNote, type PlanReview } from '@/lib/ai';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCurrency } from '@/context/CurrencyContext';

/**
 * A second opinion on a draft budget.
 *
 * The app's own statistics already suggest a number per line, and they are
 * better at that than any model — a median over six months is not a judgement
 * call. What they cannot do is look at the plan *as a whole* and notice that it
 * is internally implausible: groceries cut by 40% in the same month a gym
 * membership was added, or a total that assumes a month with no birthdays in a
 * year that has had one every month.
 *
 * That is the entire case for this call, and it is why it is a *button* rather
 * than something that fires on every keystroke. A review that regenerates while
 * you type is noise you learn to ignore.
 */

const VERDICT: Record<PlanReview['verdict'], { label: string; tone: 'positive' | 'warning' | 'negative' }> = {
  solid: { label: 'Matches how you actually spend', tone: 'positive' },
  workable: { label: 'Workable, with a couple of changes', tone: 'warning' },
  unrealistic: { label: 'History says this one breaks', tone: 'negative' },
};

const KIND: Record<PlanNote['kind'], { label: string; tone: 'negative' | 'warning' | 'primary' | 'positive' }> = {
  'too-low': { label: 'Too low', tone: 'negative' },
  'too-high': { label: 'Too high', tone: 'warning' },
  missing: { label: 'Missing', tone: 'primary' },
  good: { label: 'Well judged', tone: 'positive' },
};

export function PlanReviewCard({
  plan,
  onApply,
  className,
}: {
  /** The draft as it stands. Serialised and sent whole. */
  plan: unknown;
  /** Applies a suggested figure to a line. Absent lines are added. */
  onApply: (category: string, amount: number) => void;
  className?: string;
}) {
  const { formatRounded } = useCurrency();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [review, setReview] = useState<PlanReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    aiStatus().then(status => { if (!cancelled) setAvailable(status.configured); });
    return () => { cancelled = true; };
  }, []);

  const run = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setApplied(new Set());
    try {
      setReview(await reviewPlan(plan));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not review that plan.');
    } finally {
      setLoading(false);
    }
  };

  // Nothing renders where the server has no key. A dead control is worse than
  // an absent one.
  if (available === false) return null;

  const verdict = review ? VERDICT[review.verdict] : null;

  return (
    <section
      className={cn('rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0', className)}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] bg-pop-tint text-pop">
          <Sparkles className="h-[1.05rem] w-[1.05rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-headline">Sanity-check this plan</h2>
          <p className="text-footnote text-muted-foreground">
            Read against what you have actually spent, month after month.
          </p>
        </div>
      </div>

      {!review && (
        <Button
          type="button"
          variant="tinted"
          className="mt-4"
          onClick={() => void run()}
          disabled={loading || available === null}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              Reading your history…
            </>
          ) : (
            <>
              <Sparkles />
              Check it
            </>
          )}
        </Button>
      )}

      {error && (
        <p role="alert" className="mt-4 text-footnote text-destructive-text">
          {error}
        </p>
      )}

      {review && verdict && (
        <div className="mt-4 min-w-0">
          <Badge tone={verdict.tone} size="lg">
            {verdict.tone === 'negative' && <TriangleAlert className="h-3 w-3" />}
            {verdict.label}
          </Badge>

          <p className="mt-3 text-subhead">{review.summary}</p>

          {review.notes.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {review.notes.map((note, index) => {
                const kind = KIND[note.kind];
                const key = note.category || `plan-${index}`;
                const done = applied.has(key);

                return (
                  <li key={key} className="rounded-xl bg-subtle p-3.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {note.category && (
                        <span className="min-w-0 truncate text-subhead font-semibold">
                          {note.category}
                        </span>
                      )}
                      <Badge tone={kind.tone} size="sm">{kind.label}</Badge>
                    </div>

                    <p className="mt-1 text-footnote text-muted-foreground">{note.issue}</p>

                    {typeof note.suggested === 'number' && note.suggested > 0 && note.category && (
                      <Button
                        type="button"
                        variant={done ? 'ghost' : 'tinted'}
                        size="sm"
                        className="mt-2.5"
                        disabled={done}
                        onClick={() => {
                          onApply(note.category, note.suggested!);
                          setApplied(prev => new Set(prev).add(key));
                        }}
                      >
                        {done ? (
                          <>
                            <Check />
                            Applied
                          </>
                        ) : (
                          <>
                            Use {formatRounded(note.suggested)}
                            <ArrowRight />
                          </>
                        )}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 -ml-3"
            onClick={() => void run()}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Check again
          </Button>
        </div>
      )}
    </section>
  );
}
