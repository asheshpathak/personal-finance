import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A card is a white block on a grey page.
 *
 * That inversion — page grey, surface white — is doing all the work here, and
 * it is the opposite of how most web design systems build elevation. White on
 * #F5F6F8 is a 1.09:1 step: barely a step at all, which is exactly right. Add a
 * heavy border and it becomes a frame; add a heavy shadow and it becomes a
 * floating panel. iOS does neither, and neither does this.
 *
 * A shadow *and* a border on the same element is the tell of a system that
 * hasn't decided which one conveys depth. This one uses a hairline for
 * definition and a very soft ambient shadow for lift — nothing over 0.05 alpha,
 * blur three times the offset.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border border-border bg-card text-card-foreground shadow-card",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

/**
 * The flat variant: no shadow, no lift.
 *
 * For a card sitting inside another card, or a grouped list section — where the
 * background swap alone is the separation and a second shadow would read as a
 * stack of paper.
 */
const CardFlat = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-xl border border-border bg-card text-card-foreground", className)}
    {...props}
  />
))
CardFlat.displayName = "CardFlat"

/**
 * A well: a surface that goes *down* rather than up.
 *
 * The subtle fill inside a white card. iOS uses this for inset content — a
 * quote block, a summary strip — and it is the only correct way to nest a
 * surface without inventing a fourth elevation.
 */
const CardWell = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-lg bg-subtle", className)}
    {...props}
  />
))
CardWell.displayName = "CardWell"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1 p-5 sm:p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-headline", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-footnote text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0 sm:p-6 sm:pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-5 pt-0 sm:p-6 sm:pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardFlat,
  CardWell,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
}
