import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full min-w-0 rounded-md border border-border bg-subtle px-3.5 py-1",
          "transition-[border-color,box-shadow,background-color] duration-150",
          // 16px on touch is not a style choice: iOS Safari zooms the viewport
          // on focus for anything smaller, and the page never zooms back —
          // which is what leaves a form scrolled sideways after typing.
          "text-callout md:text-subhead md:h-10",
          "file:border-0 file:bg-transparent file:text-subhead file:font-medium file:text-foreground",
          "placeholder:text-faint",
          "hover:border-border-strong",
          // A soft ring of the accent rather than a hard outline — it reads as
          // the field lighting up rather than as a rectangle drawn around it,
          // and it survives on a rounded shape where an outline corners badly.
          "focus-visible:outline-none focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-primary/28",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
