import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORY_GROUPS } from '@/lib/expenseCategories';
import { PaymentShortcuts } from '@/components/PaymentShortcuts';
import { api } from '@/lib/api';
import type { PaymentShortcut } from '@/lib/paymentShortcuts';

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
  showShortcuts = false,
}: {
  values: ExpenseFormValues;
  onChange: (patch: Partial<ExpenseFormValues>) => void;
  /** May be async; the button shows a spinner and locks while it's pending. */
  onSubmit: (e: React.FormEvent) => void | Promise<void>;
  submitLabel: string;
  /** Quick-fill strip — opt in for recording a new payment, off when editing. */
  showShortcuts?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [saveAsShortcut, setSaveAsShortcut] = useState(false);
  /** Saved shortcut this entry came from, so its usage count can be bumped. */
  const appliedShortcutId = useRef<string | null>(null);

  const handleApplyShortcut = (shortcut: PaymentShortcut) => {
    onChange({
      amount: String(shortcut.amount),
      category: shortcut.category,
      paymentMode: shortcut.paymentMode,
      description: shortcut.description,
    });
    appliedShortcutId.current = shortcut._id;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // guard against double-submit / double-tap
    setSubmitting(true);
    try {
      await onSubmit(e);

      if (saveAsShortcut) {
        // The server collapses a duplicate onto the existing shortcut, so
        // ticking this twice for the same payment can't create a second chip.
        api.post('/api/payment-shortcuts', {
          label: values.description.trim() || values.category,
          amount: Number(values.amount),
          category: values.category,
          paymentMode: values.paymentMode,
          description: values.description,
        }).catch(err => console.error(err));
      }

      const usedId = appliedShortcutId.current;
      if (usedId) {
        appliedShortcutId.current = null;
        // Ranking metadata only — never block the save on it.
        api.post(`/api/payment-shortcuts/${usedId}/use`).catch(() => {});
      }
    } finally {
      setSubmitting(false);
    }
  };

  // The form is a grid item inside the dialog, so its default min-width of
  // `auto` would let any wide child stretch the dialog past the viewport —
  // min-w-0 keeps the layout bounded by the dialog instead of by its content.
  return (
    <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
      {showShortcuts && <PaymentShortcuts values={values} onApply={handleApplyShortcut} />}

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
            {/* Grouped so an investment or savings contribution is recorded as
                itself and lands in the right budget section. */}
            {CATEGORY_GROUPS.map(group => (
              <SelectGroup key={group.label}>
                <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </SelectLabel>
                {group.categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectGroup>
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

      {showShortcuts && (
        <label htmlFor="expense-save-shortcut" className="flex items-center gap-3 py-1 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            id="expense-save-shortcut"
            checked={saveAsShortcut}
            onChange={e => setSaveAsShortcut(e.target.checked)}
            className="w-5 h-5 flex-shrink-0 rounded border-white/20 bg-white/[0.04] accent-primary [color-scheme:dark]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-none">Save as shortcut</span>
            <span className="block text-xs text-muted-foreground mt-1">
              Pin this payment for one-tap entry next time.
            </span>
          </span>
        </label>
      )}

      <Button
        type="submit"
        disabled={submitting}
        className="w-full h-12 mt-1"
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
