import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The App Store's section header.
 *
 * Title on the left, a link on the right, baseline-aligned. It is the humblest
 * pattern in the whole app and the one that does the most: an editorial screen
 * is nothing but a stack of these with content between them, and having exactly
 * one implementation is what keeps twelve sections looking like one page.
 *
 * The "See all" is a chevron-suffixed link in the accent, which is the only
 * place in this design system colour is used for text — because there it means
 * "tappable", which is precisely what colour is *for* on this platform.
 */
export function SectionHeader({
  title,
  subtitle,
  to,
  actionLabel = 'See all',
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Renders the trailing link. Mutually exclusive with `action`. */
  to?: string;
  actionLabel?: string;
  /** A bespoke trailing control — a view toggle, a filter chip. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4 min-w-0', className)}>
      <div className="min-w-0">
        <h2 className="text-title-3 truncate">{title}</h2>
        {subtitle && (
          <div className="mt-0.5 text-footnote text-muted-foreground">{subtitle}</div>
        )}
      </div>

      {action ??
        (to && (
          <Link
            to={to}
            // -mr-2 pr-2 so the target reaches 44px without the label drifting
            // away from the card's right edge.
            className="tactile -mr-2 inline-flex h-11 flex-shrink-0 items-center gap-0.5 rounded-full pl-2 pr-2 text-subhead font-medium text-primary hover:bg-primary-tint"
          >
            {actionLabel}
            <ChevronRight className="h-4 w-4" />
          </Link>
        ))}
    </div>
  );
}

/**
 * A page's opening block: a large title with an optional lede beneath it.
 *
 * The size difference between this and a section header is deliberate and
 * large. iOS gives a screen exactly one 34pt title, and everything else steps
 * down sharply — that gap is what tells you where you are without reading.
 */
export function PageHeader({
  title,
  lede,
  action,
  className,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-title-1 sm:text-display">{title}</h1>
        {lede && <p className="mt-1.5 max-w-2xl text-subhead text-muted-foreground">{lede}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The empty state.
 *
 * Not a shrug. An empty screen is the first thing a new account sees, and the
 * only useful thing it can do is name the one action that fills it — which is
 * why the call to action is required rather than optional.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center',
        className
      )}
    >
      {Icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-faint">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="text-headline">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-subhead text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Loading placeholder in the shape of the thing that is coming. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-md', className)} aria-hidden="true" />;
}
