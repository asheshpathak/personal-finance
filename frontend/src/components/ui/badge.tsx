import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A small piece of status.
 *
 * The tones map onto the semantic families, and each one uses the *text* grade
 * of its colour rather than the fill. That distinction is where colour systems
 * usually fail an audit: `--positive` at 3.07:1 is correct for a bar or a dot
 * and illegal for eleven-pixel text, so the two are separate tokens and the
 * component picks the right one.
 */
const badgeVariants = cva(
  cn(
    'inline-flex flex-shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap',
    '[&_svg]:size-3 [&_svg]:shrink-0'
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        primary: 'bg-primary-tint text-primary',
        positive: 'bg-positive-tint text-positive-text',
        negative: 'bg-destructive-tint text-destructive-text',
        warning: 'bg-warning-tint text-warning-text',
        info: 'bg-info-tint text-info-text',
        pop: 'bg-pop-tint text-pop',
        /** For a badge over a photo or a coloured card. */
        contrast: 'bg-foreground/8 text-foreground backdrop-blur-sm',
      },
      size: {
        sm: 'h-5 px-2 text-micro',
        default: 'h-6 px-2.5 text-caption',
        lg: 'h-7 px-3 text-footnote',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

export { badgeVariants };
