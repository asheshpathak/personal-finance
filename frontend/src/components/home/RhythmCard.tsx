import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { fromDayKey } from '@/lib/dates';
import type { Rhythm } from '@/lib/rhythm';

/**
 * The habit surface.
 *
 * A contributions grid, because it is the most legible density chart there is
 * and everyone already knows how to read one. Each cell is a day; the shade is
 * what it cost.
 *
 * **The streak counts logging days, not spending outcomes.** That is the single
 * most important decision in this component. A "days under budget" streak
 * breaks on a car repair; a "no-spend streak" turns a necessary purchase into a
 * personal failure. Both teach the reader that the app is a scold, and people
 * delete apps that call them failures. A logging streak measures the one thing
 * they fully control — and it happens to be the exact behaviour the app needs
 * from them, since every total in here is only as good as its completeness.
 *
 * The streak also has a grace day built in: it survives until *yesterday* goes
 * unlogged, so it is never broken at 9am by a day that has not happened yet.
 */

const LEVEL_CLASS = [
  'bg-muted',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/65',
  'bg-primary',
] as const;

export function RhythmCard({
  rhythm,
  weeks = 18,
  className,
}: {
  rhythm: Rhythm;
  /** How many columns to show. Fewer on a phone, where cells get tiny. */
  weeks?: number;
  className?: string;
}) {
  const { formatAmount } = useCurrency();

  // Chunked into weeks, oldest first. The series is week-aligned at the source,
  // so every column is a full seven rows and nothing has to be padded.
  const columns: (typeof rhythm.cells)[] = [];
  for (let i = 0; i < rhythm.cells.length; i += 7) {
    columns.push(rhythm.cells.slice(i, i + 7));
  }
  const shown = columns.slice(-weeks);

  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6 min-w-0',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-headline">Your rhythm</h2>
          <p className="text-footnote text-muted-foreground">
            Every day you recorded something, and what it cost
          </p>
        </div>

        {rhythm.currentStreak > 0 && (
          <div className="flex flex-shrink-0 items-center gap-2 rounded-full bg-warning-tint px-3 py-1.5">
            <Flame className="h-4 w-4 flex-shrink-0 text-warning-text" />
            <span className="text-footnote font-bold text-warning-text tnum">
              {rhythm.currentStreak}-day streak
            </span>
          </div>
        )}
      </div>

      {/* ── The grid ────────────────────────────────────────────────────── */}
      <div className="scroll-x no-scrollbar mt-5 -mx-1 px-1 pb-1">
        <div className="flex gap-[3px]" role="img" aria-label="Daily spending over recent weeks">
          {shown.map((week, index) => (
            <div key={index} className="flex flex-col gap-[3px]">
              {week.map(cell => (
                <span
                  key={cell.day}
                  title={
                    cell.future
                      ? ''
                      : `${fromDayKey(cell.day).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })} — ${cell.count === 0 ? 'nothing spent' : formatAmount(cell.amount)}`
                  }
                  className={cn(
                    'h-[11px] w-[11px] flex-shrink-0 rounded-[3px] sm:h-3 sm:w-3',
                    cell.future ? 'bg-transparent' : LEVEL_CLASS[cell.level]
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── The read-out ────────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-3 divide-x divide-border">
        <Figure
          label="Logged"
          value={`${Math.round(rhythm.loggedRate * 100)}%`}
          hint="of days"
        />
        <Figure
          label="No-spend"
          value={String(rhythm.noSpendLast30)}
          hint="days in 30"
        />
        <Figure
          label="Longest run"
          value={String(rhythm.longestStreak)}
          hint={rhythm.longestStreak === 1 ? 'day' : 'days'}
        />
      </div>
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <p className="truncate text-overline uppercase text-faint">{label}</p>
      <p className="mt-1 text-title-3 tnum">{value}</p>
      <p className="text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}
