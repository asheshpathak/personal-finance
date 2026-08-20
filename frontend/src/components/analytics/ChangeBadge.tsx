import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A percentage delta, arrow and colour matching direction.
 *
 * Spending is the subject, so up is bad: an increase is rendered in the
 * destructive tone and a decrease in the success tone. `null` means there was no
 * baseline to compare against, which is shown rather than hidden.
 */
export function ChangeBadge({
  delta,
  suffix,
  className,
}: {
  delta: number | null;
  /** Optional qualifier, e.g. "vs previous 30 days". */
  suffix?: string;
  className?: string;
}) {
  if (delta === null) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-caption text-muted-foreground', className)}>
        <Minus className="w-3.5 h-3.5" />
        No prior data
      </span>
    );
  }

  const rounded = Math.round(delta);
  const flat = rounded === 0;
  const up = delta > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center text-caption font-semibold tnum',
        flat ? 'text-muted-foreground' : up ? 'text-destructive' : 'text-positive-text',
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 mr-1" />
      {flat ? '0' : `${Math.abs(rounded)}`}%
      {suffix && <span className="ml-1 font-medium text-muted-foreground">{suffix}</span>}
    </span>
  );
}
