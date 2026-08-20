import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The App Store's stats strip, borrowed wholesale.
 *
 * On a product page Apple divides the rating, the age and the size into cells
 * separated by *vertical hairlines*, each cell three stacked lines: a tiny
 * uppercase label, a semibold value, a quiet qualifier. It is the best KPI row
 * in mainstream software, and the reason is that it has no boxes — the
 * separators do all the grouping, so four numbers cost four hairlines instead
 * of four cards.
 *
 * On a phone it becomes a two-column grid instead. Apple's strip is one
 * scrolling row, but it carries three short figures; four currency amounts with
 * captions under them do not fit at 393px, and the cell clipped at the screen
 * edge reads as broken rather than as scrollable.
 */

export interface StatProps {
  label: string;
  value: React.ReactNode;
  /** The quiet third line: a comparison, a count, a unit. */
  hint?: React.ReactNode;
  /** Colours the value. Used sparingly — most figures are just figures. */
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  className?: string;
}

const TONE: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-foreground',
  positive: 'text-positive-text',
  negative: 'text-destructive-text',
  warning: 'text-warning-text',
};

export function Stat({ label, value, hint, tone = 'default', className }: StatProps) {
  return (
    <div className={cn('min-w-0 sm:px-4 sm:first:pl-0 sm:last:pr-0', className)}>
      <p className="truncate text-overline uppercase text-faint">{label}</p>
      <p className={cn('mt-1.5 truncate text-title-3 tnum', TONE[tone])}>{value}</p>
      {hint && <div className="mt-0.5 truncate text-caption text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** The strip the stats sit in: a grid on a phone, hairline-divided above it. */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Two columns on a phone, then one row per stat once there is width.
        // The App Store strip is a single scrolling row, but it carries three
        // short figures; four currency amounts with captions do not fit at
        // 393px, and a column clipped at the screen edge reads as broken
        // rather than as scrollable.
        'grid grid-cols-2 gap-x-4 gap-y-5 sm:flex sm:gap-0 sm:divide-x sm:divide-border',
        'sm:[&>*]:min-w-0 sm:[&>*]:flex-1',
        // An odd count leaves the last cell alone on its row looking clipped;
        // spanning it reads as deliberate.
        '[&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * A signed change.
 *
 * Spending is the subject, so up is bad by default — an increase renders
 * negative and a decrease positive. `invert` flips that for the figures where
 * more is better: savings, income, a streak.
 *
 * Colour is never the only channel. The arrow and the sign carry the same
 * information, which is what makes this readable to the roughly one man in
 * sixteen for whom the red/green axis is degraded, and to anyone reading a
 * printout.
 */
export function Delta({
  value,
  format,
  suffix,
  invert = false,
  className,
}: {
  /** Null means there was no baseline — shown, not hidden. */
  value: number | null;
  /** Renders the magnitude. Defaults to a rounded percentage. */
  format?: (magnitude: number) => string;
  suffix?: string;
  invert?: boolean;
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-caption text-faint', className)}>
        <Minus className="h-3.5 w-3.5" />
        No prior data
      </span>
    );
  }

  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const good = invert ? up : !up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const render = format ?? ((m: number) => `${Math.round(m)}%`);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-caption font-semibold tnum',
        flat ? 'text-muted-foreground' : good ? 'text-positive-text' : 'text-destructive-text',
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {flat ? render(0) : render(Math.abs(value))}
      {suffix && <span className="ml-1 font-medium text-muted-foreground">{suffix}</span>}
    </span>
  );
}
