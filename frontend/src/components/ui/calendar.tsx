import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MONTH_NAMES,
  MONTH_NAMES_SHORT,
  WEEKDAY_INITIALS,
  fromDayKey,
  isSameDay,
  isValidDayKey,
  monthGrid,
  startOfDay,
  toDayKey,
} from '@/lib/dates';

/**
 * The month grid every date control in the app shares.
 *
 * Purely presentational and controlled: it renders a month, reports the day
 * that was pressed, and knows nothing about whether it's picking one date or
 * the end of a range.
 */

export interface CalendarProps {
  /** Highlighted as chosen. `YYYY-MM-DD`. */
  selected?: string | null;
  /** Range mode — both ends get end-caps and everything between is tinted. */
  rangeStart?: string | null;
  rangeEnd?: string | null;
  /** The day under the cursor while a range is half-drawn. */
  hovered?: string | null;
  onHover?: (day: string | null) => void;
  onSelect: (day: string) => void;
  min?: string;
  max?: string;
  /** Month shown on open; defaults to the selection, else today. */
  defaultMonth?: string;
}

const inBounds = (day: Date, min?: string, max?: string): boolean => {
  if (min && isValidDayKey(min) && startOfDay(day) < fromDayKey(min)) return false;
  if (max && isValidDayKey(max) && startOfDay(day) > fromDayKey(max)) return false;
  return true;
};

export function Calendar({
  selected,
  rangeStart,
  rangeEnd,
  hovered,
  onHover,
  onSelect,
  min,
  max,
  defaultMonth,
}: CalendarProps) {
  const anchor = React.useMemo(() => {
    const candidate = defaultMonth ?? selected ?? rangeStart ?? toDayKey();
    return isValidDayKey(candidate) ? fromDayKey(candidate) : new Date();
  }, [defaultMonth, selected, rangeStart]);

  const [view, setView] = React.useState(() => ({ year: anchor.getFullYear(), month: anchor.getMonth() }));
  const [picking, setPicking] = React.useState<'days' | 'months' | 'years'>('days');

  // Follow the selection when it moves to another month from outside (applying
  // a preset range, say) — but never yank the view while the user is paging.
  const lastAnchorRef = React.useRef(anchor.getTime());
  React.useEffect(() => {
    if (anchor.getTime() === lastAnchorRef.current) return;
    lastAnchorRef.current = anchor.getTime();
    setView({ year: anchor.getFullYear(), month: anchor.getMonth() });
  }, [anchor]);

  const days = React.useMemo(() => monthGrid(view.year, view.month), [view]);
  const today = startOfDay(new Date());

  const shiftMonth = (delta: number) => {
    const next = new Date(view.year, view.month + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  };

  // The whole selected span, normalised so a half-drawn range previews against
  // wherever the cursor currently is.
  const span = React.useMemo(() => {
    const from = rangeStart && isValidDayKey(rangeStart) ? fromDayKey(rangeStart) : null;
    const rawTo = rangeEnd ?? hovered;
    const to = rawTo && isValidDayKey(rawTo) ? fromDayKey(rawTo) : null;
    if (!from || !to) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }, [rangeStart, rangeEnd, hovered]);

  const selectedDate = selected && isValidDayKey(selected) ? fromDayKey(selected) : null;

  const years = React.useMemo(() => {
    const current = view.year;
    return Array.from({ length: 12 }, (_, i) => current - 6 + i);
  }, [view.year]);

  return (
    <div className="w-[19.5rem] max-w-[calc(100vw-3rem)] select-none p-3">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => (picking === 'years' ? setView(v => ({ ...v, year: v.year - 12 })) : shiftMonth(-1))}
          className="tactile inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex flex-1 items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setPicking(p => (p === 'months' ? 'days' : 'months'))}
            className={cn(
              'tactile rounded-lg px-2.5 h-9 text-subhead font-semibold hover:bg-muted',
              picking === 'months' && 'bg-muted'
            )}
          >
            {MONTH_NAMES[view.month]}
          </button>
          <button
            type="button"
            onClick={() => setPicking(p => (p === 'years' ? 'days' : 'years'))}
            className={cn(
              'tactile rounded-lg px-2.5 h-9 text-subhead font-bold tnum hover:bg-muted',
              picking === 'years' && 'bg-muted'
            )}
          >
            {view.year}
          </button>
        </div>

        <button
          type="button"
          onClick={() => (picking === 'years' ? setView(v => ({ ...v, year: v.year + 12 })) : shiftMonth(1))}
          className="tactile inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── Month / year shortcuts ─────────────────────────────────── */}
      {picking === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES_SHORT.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => { setView(v => ({ ...v, month: index })); setPicking('days'); }}
              className={cn(
                'tactile rounded-lg h-11 text-subhead font-semibold hover:bg-muted',
                index === view.month ? 'bg-primary text-primary-foreground hover:bg-primary' : 'text-muted-foreground'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {picking === 'years' && (
        <div className="grid grid-cols-3 gap-1">
          {years.map(year => (
            <button
              key={year}
              type="button"
              onClick={() => { setView(v => ({ ...v, year })); setPicking('days'); }}
              className={cn(
                'tactile rounded-lg h-11 text-subhead font-semibold tnum hover:bg-muted',
                year === view.year ? 'bg-primary text-primary-foreground hover:bg-primary' : 'text-muted-foreground'
              )}
            >
              {year}
            </button>
          ))}
        </div>
      )}

      {/* ── Day grid ───────────────────────────────────────────────── */}
      {picking === 'days' && (
        <>
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAY_INITIALS.map((initial, i) => (
              <div
                key={i}
                className="flex h-7 items-center justify-center text-micro font-bold uppercase text-faint"
              >
                {initial}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => onHover?.(null)}>
            {days.map(day => {
              const key = toDayKey(day);
              const outside = day.getMonth() !== view.month;
              const disabled = !inBounds(day, min, max);
              const isSelected =
                (selectedDate && isSameDay(day, selectedDate)) ||
                (rangeStart && isValidDayKey(rangeStart) && isSameDay(day, fromDayKey(rangeStart))) ||
                (rangeEnd && isValidDayKey(rangeEnd) && isSameDay(day, fromDayKey(rangeEnd)));
              const inSpan =
                span !== null && startOfDay(day) >= span.from && startOfDay(day) <= span.to;
              const isSpanStart = span !== null && isSameDay(day, span.from);
              const isSpanEnd = span !== null && isSameDay(day, span.to);

              return (
                <div
                  key={key}
                  className={cn(
                    'relative flex items-center justify-center',
                    // The tint runs edge to edge so a range reads as one
                    // continuous band rather than a row of separate pills.
                    inSpan && !isSelected && 'bg-primary-tint',
                    inSpan && isSpanStart && 'rounded-l-lg',
                    inSpan && isSpanEnd && 'rounded-r-lg'
                  )}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(key)}
                    onMouseEnter={() => onHover?.(key)}
                    aria-label={day.toLocaleDateString('en-US', { dateStyle: 'full' })}
                    aria-current={isSameDay(day, today) ? 'date' : undefined}
                    className={cn(
                      'tactile relative flex h-10 w-full items-center justify-center rounded-lg text-subhead tnum transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                      disabled && 'cursor-not-allowed opacity-25',
                      !disabled && outside && 'text-faint',
                      !disabled && !outside && 'text-foreground',
                      !disabled && !isSelected && 'hover:bg-muted',
                      isSelected && 'bg-primary font-bold text-primary-foreground hover:bg-primary'
                    )}
                  >
                    {day.getDate()}
                    {isSameDay(day, today) && !isSelected && (
                      <span
                        className="absolute bottom-1 h-1 w-1 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
