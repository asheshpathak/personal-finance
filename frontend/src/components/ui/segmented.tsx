import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The app's filter-chip row.
 *
 * Every page had its own hand-rolled version of this — a `flex flex-wrap` of
 * bare `<button>`s with duplicated active styling and no press feedback. Three
 * problems came from that, and this fixes all of them in one place:
 *
 *  1. **Alignment.** `flex-wrap` plus an `ml-auto` trailing button breaks the
 *     moment the row wraps: the trailing item jumps to the right of its own
 *     line, leaving a ragged gap. On touch this scrolls instead, which keeps
 *     the group on one line at any width.
 *  2. **Horizontal page scroll.** A wide row of chips inside a page with no
 *     containment pushes the document sideways. `.scroll-x` carries
 *     `overscroll-behavior-x: contain`, so the swipe stays in the strip.
 *  3. **Tactility.** Bare buttons had no press state at all.
 *
 * The selected state is a **solid ink fill with white text**, not a tinted
 * accent. That inversion is a distinctly Apple move — the App Store's category
 * chips do exactly this — and it is better than a blue fill for a reason worth
 * knowing: in this app colour means "actionable" or "status", so a chip that
 * turns brand-coloured when chosen is claiming something it doesn't mean.
 * Selection is a state, and ink states it without borrowing a signal.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Announced to screen readers when `label` is an icon or abbreviation. */
  title?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'default',
  ariaLabel,
  /** Rendered after the options, inside the same scroller. */
  trailing,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'default' | 'sm';
  ariaLabel?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'scroll-x no-scrollbar -mx-1 flex items-center gap-2 px-1 py-0.5',
        // On a wide screen there is room to wrap rather than scroll, which
        // reads better than a strip that could be scrolled but never needs to.
        'sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0',
        className
      )}
    >
      {options.map(option => (
        <SegmentedButton
          key={option.value}
          selected={value === option.value}
          onClick={() => onChange(option.value)}
          size={size}
          title={option.title}
        >
          {option.label}
        </SegmentedButton>
      ))}
      {trailing}
    </div>
  );
}

/** One chip. Exported so pages can mix a bespoke control into the same row. */
export interface SegmentedButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  selected: boolean;
  /** Optional: when the chip is a popover anchor, Radix supplies the handler. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
  size?: 'default' | 'sm';
  className?: string;
  title?: string;
}

// forwardRef, because a chip is sometimes the anchor a popover positions
// against — the "Custom range" chip on the analytics bar, for one.
export const SegmentedButton = React.forwardRef<HTMLButtonElement, SegmentedButtonProps>(
  ({ selected, onClick, children, size = 'default', className, title, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        'tactile inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/28',
        size === 'sm' ? 'h-9 px-3.5 text-caption md:h-8' : 'h-11 px-4 text-footnote md:h-9',
        selected
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:bg-hover hover:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);
SegmentedButton.displayName = 'SegmentedButton';

/**
 * The iOS segmented control: a sliding thumb inside a track.
 *
 * Different from the chip row above and used for a different job — this is for
 * two to four *mutually exclusive views of the same thing* (chart / table,
 * week / month / year), where the set is fixed and short enough that all of it
 * fits. A chip row is for filtering a list that could have twenty options.
 *
 * The thumb is a real element that transitions its position, not a background
 * that swaps: the movement is what tells you the two options are one control.
 */
export function SegmentedTrack<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const index = Math.max(0, options.findIndex(o => o.value === value));

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-grid h-11 md:h-9 flex-shrink-0 rounded-full bg-muted p-[3px]',
        className
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {/* The thumb, positioned by index rather than by measuring the DOM —
          columns are equal by construction, so arithmetic is exact and there
          is no layout read to go stale on a resize. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[3px] left-[3px] rounded-full bg-card shadow-xs transition-transform duration-300 ease-snappy"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full px-3',
            'text-footnote font-semibold transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/28',
            value === option.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
