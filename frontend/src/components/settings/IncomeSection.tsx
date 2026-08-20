import { useEffect, useState } from 'react';
import { Banknote, Info, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionHeader, Skeleton } from '@/components/ui/section';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useCurrency } from '@/context/CurrencyContext';
import { useDataRefresh } from '@/context/DataRefreshContext';
import { ApiError } from '@/lib/api';
import { DAYS_OF_MONTH } from '@/lib/subscriptionDueDate';
import {
  INCOME_FREQUENCIES,
  INCOME_TYPES,
  RELIABILITY,
  createIncome,
  deleteIncome,
  listIncome,
  monthlyEquivalent,
  updateIncome,
  type IncomeFrequency,
  type IncomeSourceRecord,
  type IncomeSummary,
  type IncomeType,
  type Reliability,
} from '@/lib/incomeSources';
import { cn } from '@/lib/utils';

/**
 * Income, on the account.
 *
 * It lives in Settings rather than on a budget because it is a fact about the
 * person, not about a month. Before this it was a number typed into each
 * budget, which meant it had to be retyped every period and was invisible to
 * every other screen — so "how much is left over", "can I afford this" and "how
 * long could I last" had no denominator at all.
 *
 * The field people skip and shouldn't is **how dependable it is**. A salary and
 * a freelance retainer at the same monthly figure are not the same money, and
 * every affordability answer that treats them identically is wrong in the
 * direction that hurts.
 */

interface FormState {
  name: string;
  type: IncomeType;
  amount: string;
  frequency: IncomeFrequency;
  payDayOfMonth: string;
  reliability: Reliability;
  typicalLow: string;
  active: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  type: 'Salary',
  amount: '',
  frequency: 'monthly',
  payDayOfMonth: '',
  reliability: 'guaranteed',
  typicalLow: '',
  active: true,
});

export function IncomeSection() {
  const { formatMoney, formatRounded } = useCurrency();
  const { refresh } = useDataRefresh();

  const [sources, setSources] = useState<IncomeSourceRecord[]>([]);
  const [summary, setSummary] = useState<IncomeSummary | null>(null);
  const [ready, setReady] = useState(false);

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await listIncome();
      setSources(data.sources);
      setSummary(data.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => { void load(); }, []);

  const patch = (next: Partial<FormState>) => setForm(prev => ({ ...prev, ...next }));

  const openAdd = () => {
    setForm(emptyForm());
    setEditId(null);
    setError(null);
    setIsOpen(true);
  };

  const openEdit = (source: IncomeSourceRecord) => {
    setForm({
      name: source.name,
      type: source.type,
      amount: String(source.amount),
      frequency: source.frequency,
      payDayOfMonth: source.payDayOfMonth ? String(source.payDayOfMonth) : '',
      reliability: source.reliability,
      typicalLow: source.typicalLow ? String(source.typicalLow) : '',
      active: source.active,
    });
    setEditId(source._id);
    setError(null);
    setIsOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    const body = {
      name: form.name.trim(),
      type: form.type,
      amount: Number(form.amount),
      frequency: form.frequency,
      payDayOfMonth: form.payDayOfMonth ? Number(form.payDayOfMonth) : null,
      reliability: form.reliability,
      typicalLow: form.typicalLow ? Number(form.typicalLow) : null,
      active: form.active,
    };

    try {
      if (editId) await updateIncome(editId, body);
      else await createIncome(body);
      setIsOpen(false);
      await load();
      // Income moved, so every derived figure on every other screen moved.
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  const preview =
    Number(form.amount) > 0 && form.frequency !== 'one-off'
      ? monthlyEquivalent(Number(form.amount), form.frequency)
      : 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
      <SectionHeader
        title="Income"
        subtitle="What comes in. Used everywhere the app needs to know what you earn."
        action={
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add
          </Button>
        }
      />

      {!ready ? (
        <div className="mt-5 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : sources.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-faint">
            <Banknote className="h-5 w-5" />
          </span>
          <p className="text-subhead font-medium">No income recorded</p>
          <p className="mx-auto mt-1 max-w-sm text-caption text-muted-foreground">
            Without it the app can tell you what you spend but not whether you can afford anything.
            One salary line is enough to change every other screen.
          </p>
          <Button className="mt-4" size="sm" onClick={openAdd}>
            Add your income
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-5 rounded-xl bg-subtle p-4">
            <p className="text-overline uppercase text-faint">Take-home</p>
            <p className="mt-1 text-title-2 tnum">{formatRounded(summary?.monthly ?? 0)}<span className="text-title-3 text-muted-foreground"> / month</span></p>
            {summary && summary.conservativeMonthly < summary.monthly && (
              <p className="mt-1.5 text-caption text-muted-foreground">
                On a lean month, plan for {formatRounded(summary.conservativeMonthly)} — some of this
                is not guaranteed.
              </p>
            )}
          </div>

          <ul className="mt-4 divide-y divide-border">
            {sources.map(source => (
              <li key={source._id} className="flex items-center justify-between gap-3 py-3 min-w-0">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-row font-medium">
                    <span className="truncate">{source.name}</span>
                    {!source.active && <Badge tone="neutral" size="sm">Ended</Badge>}
                    {source.reliability !== 'guaranteed' && (
                      <Badge tone="warning" size="sm">
                        {RELIABILITY.find(r => r.value === source.reliability)?.label}
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-caption text-muted-foreground">
                    {formatMoney(source.amount)}{' '}
                    {INCOME_FREQUENCIES.find(f => f.value === source.frequency)?.label.toLowerCase()}
                    {source.frequency !== 'one-off' &&
                      ` — about ${formatRounded(monthlyEquivalent(source.amount, source.frequency))} a month`}
                    {source.payDayOfMonth ? `, on the ${source.payDayOfMonth}` : ''}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${source.name}`} onClick={() => openEdit(source)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${source.name}`}
                    className="text-destructive-text"
                    onClick={() => setDeleteId(source._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit income' : 'Add income'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="income-name">Name</Label>
                <Input
                  id="income-name"
                  required
                  value={form.name}
                  onChange={e => patch({ name: e.target.value })}
                  placeholder="Salary, rent from the flat…"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => patch({ type: v as IncomeType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCOME_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="income-amount">Amount you actually receive</Label>
                <Input
                  id="income-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  required
                  value={form.amount}
                  onChange={e => patch({ amount: e.target.value })}
                />
                {/*
                  Take-home, not gross. The app has no payroll model and never
                  will, so a gross figure would overstate every affordability
                  answer until it had a tax engine per jurisdiction.
                */}
                <p className="text-caption text-muted-foreground">
                  After tax and deductions — the figure that lands in the account.
                </p>
              </div>
              <div className="space-y-2">
                <Label>How often</Label>
                <Select value={form.frequency} onValueChange={v => patch({ frequency: v as IncomeFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCOME_FREQUENCIES.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {preview > 0 && (
                  <p className="text-caption text-muted-foreground">
                    About {formatRounded(preview)} a month.
                  </p>
                )}
                {form.frequency === 'one-off' && (
                  <p className="text-caption text-muted-foreground">
                    Counted where it lands, not spread across the year — a bonus is money, not a rate.
                  </p>
                )}
              </div>
            </div>

            {form.frequency === 'monthly' && (
              <div className="space-y-2">
                <Label>Pay day</Label>
                <Select value={form.payDayOfMonth} onValueChange={v => patch({ payDayOfMonth: v })}>
                  <SelectTrigger><SelectValue placeholder="Optional — day of month" /></SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_MONTH.map(d => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>How dependable is it?</Label>
              <div className="grid gap-2">
                {RELIABILITY.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => patch({ reliability: option.value })}
                    aria-pressed={form.reliability === option.value}
                    className={cn(
                      'tactile rounded-xl border p-3 text-left',
                      form.reliability === option.value
                        ? 'border-primary bg-primary-tint'
                        : 'border-border bg-card hover:bg-subtle'
                    )}
                  >
                    <span className="block text-subhead font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-caption text-muted-foreground">{option.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            {form.reliability === 'variable' && (
              <div className="space-y-2">
                <Label htmlFor="income-low">A bad month looks like</Label>
                <Input
                  id="income-low"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={form.typicalLow}
                  onChange={e => patch({ typicalLow: e.target.value })}
                  placeholder="Optional"
                />
                <p className="flex gap-2 text-caption text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0">
                    Planning uses this rather than the average, so a good quarter does not turn into
                    a permanent assumption. Left blank, the app discounts variable income by 30%.
                  </span>
                </p>
              </div>
            )}

            <div className="rounded-lg bg-subtle p-3.5">
              <Switch
                checked={form.active}
                onCheckedChange={active => patch({ active })}
                label="Still receiving this"
                description="Turn off when it stops. The history stays; future figures don't count it."
              />
            </div>

            {error && <p className="text-footnote text-destructive-text" role="alert">{error}</p>}

            <Button type="submit" size="block" disabled={saving}>
              {saving ? <><Loader2 className="animate-spin" />Saving…</> : editId ? 'Save changes' : 'Add income'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete this income source?"
        description="Every figure that depends on what you earn will change. If it has simply ended, switch it off instead — that keeps the record."
        onConfirm={async () => {
          if (!deleteId) return;
          await deleteIncome(deleteId);
          setDeleteId(null);
          await load();
          refresh();
        }}
      />
    </section>
  );
}
