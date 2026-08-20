import * as React from "react"

import { cn } from "@/lib/utils"

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /**
   * Bounds the table's height and pins its header row while the rows scroll
   * underneath.
   *
   * Opt-in rather than default, because it makes the table its own vertical
   * scroller — and a nested scroller is exactly what steals momentum on iOS.
   * That trade is only worth making where a table is genuinely long *and* only
   * rendered on a pointer device; the phone layouts here use card lists, so
   * nothing on touch is affected.
   */
  stickyHeader?: boolean;
  /** Height cap for the scroll area when `stickyHeader` is set. */
  maxHeight?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, stickyHeader = false, maxHeight = "70dvh", ...props }, ref) => (
    // overscroll-contain keeps a swipe inside a wide table instead of handing
    // it to the document and panning the whole page. min-w-0 stops the wrapper
    // itself from being sized by the table it is supposed to contain.
    <div
      className={cn(
        "relative w-full min-w-0 overflow-x-auto overscroll-contain",
        stickyHeader ? "overflow-y-auto" : "overflow-y-hidden"
      )}
      style={stickyHeader ? { maxHeight } : undefined}
    >
      <table
        ref={ref}
        className={cn(
          "w-full caption-bottom text-subhead",
          // The header sticks to the scroll container, so it needs its own
          // opaque background — the rows would otherwise show through it.
          stickyHeader && "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead_tr]:bg-card",
          className
        )}
        {...props}
      />
    </div>
  )
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-subtle font-semibold [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border transition-colors hover:bg-subtle data-[state=selected]:bg-primary-tint",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-3 text-left align-middle text-overline uppercase text-faint",
      "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-subhead text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
