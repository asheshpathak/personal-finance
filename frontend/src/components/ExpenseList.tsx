import * as React from 'react';
import { Banknote, ChevronRight, CreditCard, Landmark, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { colorForName, tintForName } from '@/lib/chartTheme';
import { formatDay, toDayKey } from '@/lib/dates';

/**
 * The transaction row.
 *
 * Lifted from the App Store's app row, because it is the best list row in
 * mainstream software and the reasons are all structural: a coloured leading
 * glyph, a two-line text stack that truncates rather than wraps, a trailing
 * value that never moves, and a separator **inset to the text** rather than
 * running to the screen edge. That last detail is what makes a list of forty
 * rows read as a list rather than as a table with the lines showing.
 *
 * **The whole row is the control.** There are no per-row edit and delete
 * buttons, and their absence is deliberate: two 36px targets crammed against a
 * right-aligned amount is how a list stops being scannable, and on touch —
 * where there is no hover to hide them behind — they are permanently in the
 * way. Tapping the row opens it, and everything you can do to a payment lives
 * there. That is also just how every list on the platform behaves.
 */

export interface ExpenseItem {
  _id: string;
  amount: number;
  category: string;
  paymentMode: string;
  description?: string;
  date: string;
  createdAt?: string;
  source?: 'manual' | 'subscription';
}

const MODE_ICON: Record<string, LucideIcon> = {
  'Credit Card': CreditCard,
  'Debit Card': CreditCard,
  Cash: Banknote,
  'Bank Transfer': Landmark,
};

/** Newest first, by expense day then by when it was recorded. Same-day entries
 *  are stored at local noon, so `date` alone ties — createdAt breaks it. */
export function byRecency(a: ExpenseItem, b: ExpenseItem): number {
  const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (byDate !== 0) return byDate;
  return new Date(b.createdAt ?? b.date).getTime() - new Date(a.createdAt ?? a.date).getTime();
}

/** "Today" / "Yesterday" / "Mon, 4 Aug" — a header a person reads, not a date. */
function dayHeading(day: string, today: string): string {
  if (day === today) return 'Today';
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === toDayKey(yesterday)) return 'Yesterday';

  const date = new Date(`${day}T12:00:00`);
  const thisYear = date.getFullYear() === new Date(`${today}T12:00:00`).getFullYear();
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' }),
  });
}

export function ExpenseRow({
  expense,
  onOpen,
}: {
  expense: ExpenseItem;
  onOpen?: (expense: ExpenseItem) => void;
}) {
  const { formatMoney } = useCurrency();
  const Icon = MODE_ICON[expense.paymentMode] ?? Landmark;
  const auto = expense.source === 'subscription';
  const title = expense.description || expense.category;

  const inner = (
    <>
      {/* The leading glyph. Its hue comes from the category *name*, not from the
          row's position — assigning by rank means a category changes colour the
          moment a payment reorders the list, which quietly destroys the reader's
          ability to follow one thing down the page. */}
      <span
        aria-hidden="true"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.7rem]"
        style={{
          backgroundColor: tintForName(expense.category),
          color: colorForName(expense.category),
        }}
      >
        <Icon className="h-[1.05rem] w-[1.05rem]" strokeWidth={2.1} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-row font-medium">{title}</span>
          {auto && (
            <Zap
              className="h-3 w-3 flex-shrink-0 text-faint"
              aria-label="Recorded automatically by a subscription"
            />
          )}
        </span>
        <span className="block truncate text-footnote text-muted-foreground">
          {expense.description ? `${expense.category} · ` : ''}
          {expense.paymentMode}
        </span>
      </span>

      <span className="flex flex-shrink-0 items-center gap-1">
        <span className="text-row font-semibold tnum">{formatMoney(expense.amount)}</span>
        {onOpen && (
          <ChevronRight
            className="h-4 w-4 flex-shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </span>
    </>
  );

  if (!onOpen) {
    return <div className="flex items-center gap-3 py-2.5 min-w-0">{inner}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(expense)}
      // Negative margin plus matching padding so the pressed/hover surface
      // extends past the text without the row itself being inset.
      className={cn(
        'tactile group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left min-w-0',
        'hover:bg-subtle active:bg-muted',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/28'
      )}
      aria-label={`${title}, ${expense.category}. Open to edit.`}
    >
      {inner}
    </button>
  );
}

/**
 * A day's worth of payments, under one heading.
 *
 * The heading carries the day's total, which is what people actually scan a
 * transaction list for — "what did Saturday cost" is a more common question
 * than any individual line.
 */
export function ExpenseList({
  expenses,
  onOpen,
  today = toDayKey(),
  className,
}: {
  expenses: ExpenseItem[];
  onOpen?: (expense: ExpenseItem) => void;
  today?: string;
  className?: string;
}) {
  const { formatMoney } = useCurrency();

  const days = React.useMemo(() => {
    const grouped = new Map<string, ExpenseItem[]>();
    for (const expense of [...expenses].sort(byRecency)) {
      const day = toDayKey(new Date(expense.date));
      const list = grouped.get(day) ?? [];
      list.push(expense);
      grouped.set(day, list);
    }
    return [...grouped.entries()];
  }, [expenses]);

  return (
    <div className={cn('min-w-0', className)}>
      {days.map(([day, items]) => (
        <section key={day} className="min-w-0">
          <header className="flex items-baseline justify-between gap-3 pb-1 pt-4 first:pt-0">
            <h3 className="truncate text-footnote font-semibold text-muted-foreground">
              {dayHeading(day, today)}
            </h3>
            <span className="flex-shrink-0 text-footnote text-faint tnum">
              {formatMoney(items.reduce((total, e) => total + e.amount, 0))}
            </span>
          </header>

          {/* The separator is inset to align with the text rather than running
              to the card edge — the detail that keeps a long list from reading
              as a grid. It sits on a wrapper so the row itself can still take
              the full-width press surface. */}
          <ul>
            {items.map((expense, index) => (
              <li
                key={expense._id}
                className={cn(index > 0 && 'border-t border-border ml-[3.25rem] pl-0')}
              >
                <div className={cn(index > 0 && '-ml-[3.25rem]')}>
                  <ExpenseRow expense={expense} onOpen={onOpen} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A compact row for a card showing a handful, not a history. */
export function MiniExpenseRow({ expense }: { expense: ExpenseItem }) {
  const { formatMoney } = useCurrency();

  return (
    <div className="flex items-center gap-3 py-2 min-w-0">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: colorForName(expense.category) }}
      />
      <span className="min-w-0 flex-1 truncate text-subhead">
        {expense.description || expense.category}
      </span>
      <span className="flex-shrink-0 text-footnote text-faint">
        {formatDay(new Date(expense.date), { year: undefined })}
      </span>
      <span className="w-20 flex-shrink-0 text-right text-subhead font-semibold tnum">
        {formatMoney(expense.amount)}
      </span>
    </div>
  );
}
