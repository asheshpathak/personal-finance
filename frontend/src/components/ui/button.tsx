import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Press physics.
 *
 * A button feels physical when it answers *immediately* and recovers *slowly* —
 * that asymmetry is the whole trick. A single duration applies to both halves,
 * so the press lags by a fifth of a second and reads as mush; overriding the
 * way down to 60ms snaps it while leaving the release on a spring.
 *
 * `active:` (not `:hover`) is what carries this on touch, where there is no
 * hover at all.
 *
 * Capsules by default, which is the iOS 26 control shape. A pill also solves a
 * real problem a rounded rectangle has: at 44px tall with a two-word label the
 * corner radius has to be re-tuned constantly to look right, and a capsule
 * never does.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full",
    "text-subhead font-semibold",
    "transition-all duration-200 ease-spring will-change-transform",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/28",
    "active:scale-[0.965] active:duration-[60ms]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-[1.05rem] [&_svg]:shrink-0"
  ),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-primary-glow hover:bg-primary-hover active:shadow-primary-press",

        /**
         * The App Store's GET pill: tinted text on a neutral translucent fill.
         * This is Apple's answer for an action that is primary *for its row*
         * but must not shout across a list of twenty of them — and it is why a
         * saturated filled button inside a list always looks wrong on iOS.
         */
        tinted:
          "bg-primary-tint text-primary hover:bg-primary-border/60 active:bg-primary-border",

        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-95 active:brightness-90",

        /** Destructive, quietly. For a delete that sits next to an edit. */
        "destructive-soft":
          "bg-destructive-tint text-destructive-text hover:bg-destructive-border/70 active:bg-destructive-border",

        outline:
          "border border-border bg-card text-foreground shadow-xs hover:bg-subtle hover:border-border-strong active:bg-hover",

        secondary:
          "bg-muted text-secondary-foreground hover:bg-hover active:bg-border",

        ghost:
          "text-foreground hover:bg-muted active:bg-hover",

        link:
          "text-primary underline-offset-4 hover:underline active:opacity-70",
      },
      /**
       * Mobile-first: every size clears the 44px iOS minimum on touch, then
       * tightens to the denser pointer scale at md. A control that is a
       * coin-flip to hit with a thumb is most of why an app feels unreliable.
       */
      size: {
        default: "h-11 px-4 md:h-9",
        sm: "h-10 px-3 text-footnote md:h-8",
        lg: "h-12 px-6 text-callout md:h-11",
        /** Full-width primary action at the foot of a form or sheet. */
        block: "h-[3.25rem] w-full px-6 text-callout",
        icon: "h-11 w-11 md:h-9 md:w-9",
        "icon-sm": "h-9 w-9 md:h-8 md:w-8 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
