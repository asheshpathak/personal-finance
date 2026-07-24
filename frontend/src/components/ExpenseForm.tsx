import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EXPENSE_CATEGORIES } from '@/lib/expenseCategories';

export const PAYMENT_MODES = ['Credit Card', 'Debit Card', 'Cash', 'Bank Transfer'];

export type ExpenseFormValues = {
  amount: string;
  category: string;
  paymentMode: string;
  description: string;
  /** `YYYY-MM-DD`, the format <input type="date"> requires. */
  date: string;
};

/** Local calendar date as `YYYY-MM-DD`. Avoids toISOString(), which is UTC and
 *  can land on the previous day for users in negative-offset timezones. */
export function toDateInputValue(value: Date | string = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function emptyExpenseForm(): ExpenseFormValues {
  return { amount: '', category: '', paymentMode: '', description: '', date: toDateInputValue() };
}

/**
 * Defined at module scope, NOT inside a page component. A component declared
 * inside another component is a new type on every render, so React unmounts and
 * remounts the whole subtree on each keystroke — which drops input focus and
 * dismisses the keyboard on iOS.
 */
export function ExpenseForm({
  values,
  onChange,
  onSubmit,
  submitLabel,
}: {
  values: ExpenseFormValues;
  onChange: (patch: Partial<ExpenseFormValues>) => void;
  /** May be async; the button shows a spinner and locks while it's pending. */
  onSubmit: (e: React.FormEvent) => void | Promise<void>;
  submitLabel: string;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // guard against double-submit / double-tap
    setSubmitting(true);
    try {
      await onSubmit(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="expense-amount">Amount</Label>
        <Input
          id="expense-amount"
          type="number"
          step="0.01"
          min="0"
          required
          inputMode="decimal"
          placeholder="0.00"
          value={values.amount}
          onChange={e => onChange({ amount: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-date">Date</Label>
        <Input
          id="expense-date"
          type="date"
          required
          // Capped at today: this exists for backdating, and a future date would
          // silently drop the expense out of every "recent" window.
          max={toDateInputValue()}
          value={values.date}
          onChange={e => onChange({ date: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-category">Category</Label>
        <Select value={values.category} onValueChange={category => onChange({ category })} required>
          <SelectTrigger id="expense-category">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-payment">Payment Mode</Label>
        <Select value={values.paymentMode} onValueChange={paymentMode => onChange({ paymentMode })} required>
          <SelectTrigger id="expense-payment">
            <SelectValue placeholder="Select payment mode" />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_MODES.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-description">Description</Label>
        <Input
          id="expense-description"
          placeholder="Optional"
          value={values.description}
          onChange={e => onChange({ description: e.target.value })}
        />
      </div>

      <Button
        type="submit"
        disabled={submitting}
        className="rounded-xl w-full h-11 bg-foreground text-background hover:bg-foreground/90"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}
