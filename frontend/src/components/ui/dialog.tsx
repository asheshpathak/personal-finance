"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One component, two presentations.
 *
 * Below `sm` this is a **bottom sheet**: anchored to the bottom edge, full
 * width, rounded only at the top, sliding up on the iOS curve. Above it, a
 * centred dialog. They are the same Radix primitive with different geometry,
 * which matters — a sheet built as a separate component means two focus traps,
 * two dismiss paths and two sets of bugs.
 *
 * The sheet is not decoration. A centred modal on a phone puts its content in
 * the middle of the screen and its submit button under the keyboard, while a
 * sheet rises from the thumb and keeps its action within reach. It is also
 * where the platform has landed: every iOS presentation of this shape is a
 * sheet with a grabber.
 */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Lighter than a dark-theme scrim would be: on a light canvas a 70%
      // black overlay reads as the lights going out rather than as focus
      // moving forward.
      "fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px] animate-fade-in",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Hides the close button — for a sheet whose only exits are its own. */
    hideClose?: boolean
  }
>(({ className, children, hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 grid bg-popover text-popover-foreground",

        // ── Phone: a sheet ────────────────────────────────────────────────
        "inset-x-0 bottom-0 top-auto",
        "rounded-t-[1.75rem] rounded-b-none",
        // dvh, so the browser's collapsing toolbar doesn't leave a gap under
        // the sheet or push its foot off-screen.
        "max-h-[92dvh]",
        // Padding under the home indicator, so the submit button is never
        // sitting on the gesture bar.
        "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        "shadow-sheet animate-sheet-in",

        // ── Pointer: a centred dialog ─────────────────────────────────────
        "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2",
        "sm:-translate-x-1/2 sm:-translate-y-1/2",
        "sm:rounded-2xl sm:pb-0",
        // Width measured against the *viewport*, not a percentage of some
        // ancestor. A grid child that measures wider than its track — a long
        // category name in a select trigger, a row of quick-fill chips —
        // otherwise stretches the dialog past the screen edge and lets the
        // whole page pan sideways.
        "sm:w-[calc(100vw-3rem)] sm:max-w-lg sm:max-h-[86dvh]",
        "sm:shadow-popover sm:animate-dialog-in",
        "sm:border sm:border-border",

        // A grid track defaults to `auto`, which means "as wide as the widest
        // child". Pinning the single column to minmax(0,1fr) inverts that:
        // children shrink to the dialog instead of the dialog growing to the
        // children. Without this the max-width above can still be overrun.
        "grid-cols-[minmax(0,1fr)] gap-4",

        // overflow-x hidden so the dialog can never itself become a sideways
        // scroller; overscroll-contain so a swipe past the end of its content
        // doesn't hand the gesture to the page underneath.
        "overflow-y-auto overflow-x-hidden overscroll-contain",

        "p-5 pt-4 sm:p-6",
        className
      )}
      {...props}
    >
      {/*
        The grabber. Purely an affordance — it says "this can be pulled down"
        before anyone tries, which is the entire reason iOS draws one. Hidden
        on pointer devices, where there is nothing to grab.
      */}
      <div
        aria-hidden="true"
        className="sm:hidden mx-auto -mt-1 mb-1 h-[5px] w-9 flex-shrink-0 rounded-full bg-border-strong"
      />

      {children}

      {!hideClose && (
        // Sized to a real tap target — the icon alone gives a ~16px hit area.
        <DialogPrimitive.Close className="tactile absolute right-3 top-3 sm:right-4 sm:top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/28 disabled:pointer-events-none">
          <X className="h-4 w-4" strokeWidth={2.5} />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    // pr-12 clears the close button, so a long title wraps above it rather than
    // running underneath it.
    className={cn("flex flex-col gap-1 min-w-0 pr-12 text-left", className)}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    // column-reverse on touch puts the confirming action on top, closest to the
    // thumb, while keeping the DOM order (cancel first) that a keyboard and a
    // screen reader expect.
    className={cn(
      "flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title-3", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-subhead text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
