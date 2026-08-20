import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExpenseForm, emptyExpenseForm, toDateInputValue } from '@/components/ExpenseForm';
import type { ExpenseFormValues } from '@/components/ExpenseForm';
import { api } from '@/lib/api';
import type { ExpenseItem } from '@/components/ExpenseList';

/**
 * One payment, opened.
 *
 * Separate from the quick-add sheet on purpose. Recording and correcting are
 * different tasks with different shapes: recording wants speed and defaults,
 * correcting wants every field visible at once because the person already knows
 * which one is wrong. Folding both into one component produces something that
 * is mediocre at each.
 *
 * Deleting lives here rather than as a button on the list row. A destructive
 * control sitting permanently beside forty amounts is both visual clutter and a
 * mis-tap waiting to happen; behind a deliberate open, with a confirmation
 * after it, it is two intentional actions.
 *
 * Opening is driven by the presence of an expense rather than by a boolean, so
 * a caller cannot reach the state of "open, with nothing to edit".
 */
export function ExpenseEditDialog({
  expense,
  onOpenChange,
  onSaved,
  onDelete,
}: {
  expense: ExpenseItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Hands the id back so the page can run its own confirmation. */
  onDelete?: (id: string) => void;
}) {
  const [form, setForm] = useState<ExpenseFormValues>(emptyExpenseForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Loads whenever a *different* payment is opened.
   *
   * Adjusted during render against a stored id rather than in an effect: React
   * re-runs this render before committing, so the form is never painted for one
   * frame holding the previous payment's figures. Keyed on the id rather than
   * the object, so a refetch that produces a new reference for the same row
   * doesn't discard whatever is half-typed.
   * (https://react.dev/learn/you-might-not-need-an-effect)
   */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (expense && expense._id !== loadedId) {
    setLoadedId(expense._id);
    setError(null);
    setForm({
      amount: String(expense.amount),
      category: expense.category,
      paymentMode: expense.paymentMode,
      description: expense.description ?? '',
      date: toDateInputValue(expense.date),
    });
  }

  const patch = (next: Partial<ExpenseFormValues>) => setForm(prev => ({ ...prev, ...next }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!expense || saving) return;
    setError(null);
    setSaving(true);

    try {
      await api.put(`/api/expenses/${expense._id}`, {
        amount: Number(form.amount),
        category: form.category,
        paymentMode: form.paymentMode,
        description: form.description,
        // Local noon, so the stored instant can't slip to the adjacent day for
        // anyone far from UTC.
        date: new Date(`${form.date}T12:00:00`).toISOString(),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setError('Could not save that change. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={expense !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit payment</DialogTitle>
        </DialogHeader>

        {/* An auto-posted charge is editable, but the correction usually belongs
            upstream: change the subscription and every future charge is right,
            rather than this one only. */}
        {expense?.source === 'subscription' && (
          <p className="rounded-lg bg-subtle px-3.5 py-2.5 text-footnote text-muted-foreground">
            A subscription recorded this. Correcting the amount here fixes this one charge —
            edit the subscription to fix every future one.
          </p>
        )}

        <ExpenseForm
          values={form}
          onChange={patch}
          onSubmit={submit}
          submitLabel={saving ? 'Saving…' : 'Save changes'}
        />

        {error && <p role="alert" className="text-footnote text-destructive-text">{error}</p>}

        {onDelete && expense && (
          <Button
            type="button"
            variant="destructive-soft"
            className="w-full"
            onClick={() => {
              const id = expense._id;
              onOpenChange(false);
              // After the sheet has closed, so the confirmation isn't stacked
              // on top of a dialog that is still animating out.
              window.setTimeout(() => onDelete(id), 220);
            }}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete this payment
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
