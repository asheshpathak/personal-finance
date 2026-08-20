import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

/**
 * An anchored popover.
 *
 * Built on Radix rather than hand-rolled, and the reason is worth recording:
 * the app's date pickers open *inside* modal dialogs. A modal Radix dialog sets
 * `pointer-events: none` on `<body>` and traps focus, so a panel portalled to
 * the body by any other means is both unclickable and instantly robbed of
 * focus. Radix's popover registers as a nested dismissable layer and focus
 * scope, which pauses the dialog's trap and re-enables pointer events for the
 * layer above — the only reason a picker-inside-a-dialog works at all.
 *
 * `position: fixed` was the other candidate and is simply wrong here:
 * `DialogContent` is translated on the pointer breakpoint, and a transform
 * makes an ancestor the containing block for fixed descendants, so viewport
 * coordinates would land the panel in the wrong place.
 */

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The element the panel anchors to. Rendered as-is — Radix injects the ref,
   * the click handling and the ARIA wiring through `asChild`, so it must be a
   * single element that forwards refs and spreads props.
   */
  trigger: React.ReactElement;
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
  label?: string;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  sideOffset = 8,
  className,
  label,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {/* asChild so the caller's own control *is* the anchor — no wrapper
          element to disturb the layout it sits in. */}
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={sideOffset}
          aria-label={label}
          // Keeps the panel clear of the screen edge, which on a phone is what
          // stops a wide calendar from creating horizontal page scroll.
          collisionPadding={12}
          className={cn(
            'z-[60] overflow-y-auto overscroll-contain rounded-xl border border-border',
            'bg-popover text-popover-foreground shadow-popover animate-pop-in',
            // Radix measures the space available; capping to it means a tall
            // calendar scrolls inside the panel instead of running off-screen.
            'max-h-[var(--radix-popover-content-available-height)]',
            'max-w-[calc(100vw-1.5rem)]',
            className
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
