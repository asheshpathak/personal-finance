import { cn } from '@/lib/utils';

/**
 * The mark.
 *
 * Four squares — the tetra — in the brand indigo, one dropped to the accent so
 * the mark has a point of interest at 24px. Drawn rather than set as a letter
 * in a box: a rounded square with a capital T in it is the single most
 * over-used app icon shape there is, and it was exactly what the old one did.
 *
 * No gradient. A gradient in a wordmark is a claim about depth that a flat mark
 * makes better, and it is the first thing that dates an interface.
 */
export function Wordmark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Tetra"
      className={cn('flex-shrink-0', className)}
    >
      <rect width="32" height="32" rx="8.5" className="fill-primary" />
      <rect x="7" y="7" width="8" height="8" rx="2.5" fill="white" fillOpacity="0.95" />
      <rect x="17" y="7" width="8" height="8" rx="2.5" fill="white" fillOpacity="0.55" />
      <rect x="7" y="17" width="8" height="8" rx="2.5" fill="white" fillOpacity="0.55" />
      <rect x="17" y="17" width="8" height="8" rx="2.5" className="fill-pop" />
    </svg>
  );
}

export function Lockup({
  compact = false,
  className,
}: {
  /** Hides the wordmark text below `lg`, for a collapsed rail. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Wordmark size={30} />
      <span
        className={cn(
          'text-title-3 tracking-[-0.02em]',
          compact && 'hidden lg:inline'
        )}
      >
        Tetra
      </span>
    </div>
  );
}
