import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { DEBT_CATEGORIES, DEBT_KINDS, type DebtCategory, type DebtKind } from '@/lib/debts';
import { DAYS_OF_MONTH, DAYS_OF_WEEK, MONTHS, type DayOfWeek } from '@/lib/subscriptionDueDate';
import { PAYMENT_MODES } from '@/components/ExpenseForm';
import type { Frequency } from '@/lib/subscriptionTotals';
import { cn } from '@/lib/utils';

/**
 * The debt form.
 *
 * The field that does the most work here is **"balance outstanding, as of"**,
 * and it is worth saying why it is asked for instead of the original loan
 * amount. Almost nobody enters a debt into an app on the day they take it out.
 * They enter it three years in, from a statement — and the figure on that
 * statement is the outstanding balance, not the sanctioned amount. Asking for
 * the original principal and a tenure and deriving the rest would require them
 * to reconstruct a payment history they do not have, and would be wrong by
 * however many payments they had actually made.
 *
 * So the balance is the anchor, the date is when it was true, and everything
 * else — the payoff date, the interest remaining, the effect of a part payment
 * — is replayed forward from there. The original principal is asked for last
 * and is optional, because the only thing it buys is a progress bar.
 */

export interface DebtFormState {
  name: string;
  lender: string;
  category: DebtCategory | '';
  kind: DebtKind;
  openingBalance: string;
  balanceAsOf: string;
  annualRate: string;
  emiAmount: string;
  frequency: Frequency;
  dueDayOfWeek: DayOfWeek | '';
  dueDayOfMonth: string;
  dueMonth: string;
  principal: string;
  termMonths: string;
  creditLimit: string;
  minimumFraction: string;
  autoRecord: boolean;
  paymentMode: string;
  notes: string;
}

export const emptyDebtForm = (today: string): DebtFormState => ({
  name: '',
  lender: '',
  category: '',
  kind: 'amortizing',
  openingBalance: '',
  balanceAsOf: today,
  annualRate: '',
  emiAmount: '',
  frequency: 'monthly',
  dueDayOfWeek: '',
  dueDayOfMonth: '',
  dueMonth: '',
  principal: '',
  termMonths: '',
  creditLimit: '',
  minimumFraction: '',
  autoRecord: true,
  paymentMode: 'Bank Transfer',
  notes: '',
});

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'daily', label: 'Daily' },
];

/**
 * Module scope, not inside the page — a component declared inline is a new type
 * on every render, so React remounts the inputs and drops focus on every
 * keystroke.
 */
export function DebtForm({
  form,
  patch,
  onSubmit,
  submitLabel,
  error,
  scheduleNotice,
  today,
  /** Live warning that the instalment will never clear the balance. */
  growthWarning,
}: {
  form: DebtFormState;
  patch: (next: Partial<DebtFormState>) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  error: string | null;
  scheduleNotice?: string | null;
  today: string;
  growthWarning?: string | null;
}) {
  const interestBearing = form.kind !== 'interest-free';
  const revolving = form.kind === 'revolving';

  const handleFrequency = (frequency: Frequency) => {
    // The due-date fields mean different things per cadence, so carrying a
    // stale one over would submit a day-of-month for a weekly instalment.
    patch({ frequency, dueDayOfWeek: '', dueDayOfMonth: '', dueMonth: '' });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 min-w-0">
      <div className="space-y-2">
        <Label>What kind of debt is it?</Label>
        <div className="grid gap-2">
          {DEBT_KINDS.map(kind => (
            <button
              key={kind.value}
              type="button"
              onClick={() => patch({ kind: kind.value })}
              aria-pressed={form.kind === kind.value}
              className={cn(
                'tactile rounded-xl border p-3 text-left',
                form.kind === kind.value
                  ? 'border-primary bg-primary-tint'
                  : 'border-border bg-card hover:bg-subtle'
              )}
            >
              <span className="block text-subhead font-semibold">{kind.label}</span>
              <span className="mt-0.5 block text-caption text-muted-foreground">{kind.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="debt-name">Name</Label>
          <Input
            id="debt-name"
            required
            value={form.name}
            onChange={e => patch({ name: e.target.value })}
            placeholder="Home loan, Regalia card…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="debt-lender">Lender</Label>
          <Input
            id="debt-lender"
            value={form.lender}
            onChange={e => patch({ lender: e.target.value })}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={form.category} onValueChange={v => patch({ category: v as DebtCategory })} required>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {DEBT_CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── The anchor ────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-xl bg-subtle p-3.5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="debt-balance">Balance outstanding</Label>
            <Input
              id="debt-balance"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              required
              value={form.openingBalance}
              onChange={e => patch({ openingBalance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="debt-asof">As of</Label>
            <DatePicker
              id="debt-asof"
              value={form.balanceAsOf}
              onChange={balanceAsOf => patch({ balanceAsOf })}
              max={today}
            />
          </div>
        </div>
        <p className="flex gap-2 text-caption text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">
            Take these straight off your latest statement. Everything else — the payoff date, the
            interest left, what a part payment would do — is worked out from this figure forward, so
            it never needs correcting again unless the lender's number and ours drift apart.
          </span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="debt-emi">{revolving ? 'What you pay each month' : 'Instalment'}</Label>
          <Input
            id="debt-emi"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            required
            value={form.emiAmount}
            onChange={e => patch({ emiAmount: e.target.value })}
          />
          {revolving && (
            <p className="text-caption text-muted-foreground">
              What you actually pay, not the minimum due. If it is the minimum, put that.
            </p>
          )}
        </div>

        {interestBearing && (
          <div className="space-y-2">
            <Label htmlFor="debt-rate">Interest rate (% a year)</Label>
            <Input
              id="debt-rate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              inputMode="decimal"
              required
              value={form.annualRate}
              onChange={e => patch({ annualRate: e.target.value })}
              placeholder={revolving ? '42' : '8.5'}
            />
          </div>
        )}
      </div>

      {growthWarning && (
        <p className="flex gap-2 rounded-lg bg-destructive-tint px-3.5 py-3 text-caption text-destructive-text" role="alert">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">{growthWarning}</span>
        </p>
      )}

      {/* ── Schedule ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>How often</Label>
          <Select value={form.frequency} onValueChange={v => handleFrequency(v as Frequency)} required>
            <SelectTrigger><SelectValue placeholder="Frequency" /></SelectTrigger>
            <SelectContent>
              {FREQUENCIES.map(f => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.frequency === 'weekly' && (
          <div className="space-y-2">
            <Label>Due day</Label>
            <Select value={form.dueDayOfWeek} onValueChange={v => patch({ dueDayOfWeek: v as DayOfWeek })} required>
              <SelectTrigger><SelectValue placeholder="Day of week" /></SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map(d => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(form.frequency === 'monthly' || form.frequency === 'yearly') && (
          <div className="space-y-2">
            <Label>Due day</Label>
            <Select value={form.dueDayOfMonth} onValueChange={v => patch({ dueDayOfMonth: v })} required>
              <SelectTrigger><SelectValue placeholder="Day of month" /></SelectTrigger>
              <SelectContent>
                {DAYS_OF_MONTH.map(d => (
                  <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {form.frequency === 'yearly' && (
          <div className="space-y-2">
            <Label>Due month</Label>
            <Select value={form.dueMonth} onValueChange={v => patch({ dueMonth: v })} required>
              <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {form.frequency === 'monthly' && (
        <p className="text-caption text-muted-foreground">
          A day past the end of a short month bills on its last day — the 31st becomes Feb 28, the
          same clamping every lender does.
        </p>
      )}

      {scheduleNotice && (
        <p className="flex gap-2 rounded-lg bg-subtle px-3.5 py-3 text-caption text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">{scheduleNotice}</span>
        </p>
      )}

      {revolving && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="debt-limit">Credit limit</Label>
            <Input
              id="debt-limit"
              type="number"
              min="0"
              inputMode="decimal"
              value={form.creditLimit}
              onChange={e => patch({ creditLimit: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="debt-min">Minimum due (% of balance)</Label>
            <Input
              id="debt-min"
              type="number"
              step="0.1"
              min="0"
              max="100"
              inputMode="decimal"
              value={form.minimumFraction}
              onChange={e => patch({ minimumFraction: e.target.value })}
              placeholder="5"
            />
          </div>
        </div>
      )}

      {/* ── Optional context ──────────────────────────────────────────── */}
      <details className="rounded-xl border border-border">
        <summary className="tactile cursor-pointer list-none px-3.5 py-3 text-subhead font-medium">
          Original loan details
          <span className="mt-0.5 block text-caption font-normal text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">
            Optional — only used to show progress
          </span>
        </summary>
        <div className="grid gap-4 border-t border-border p-3.5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="debt-principal">Amount borrowed</Label>
            <Input
              id="debt-principal"
              type="number"
              min="0"
              inputMode="decimal"
              value={form.principal}
              onChange={e => patch({ principal: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="debt-term">Original tenure (months)</Label>
            <Input
              id="debt-term"
              type="number"
              min="0"
              inputMode="numeric"
              value={form.termMonths}
              onChange={e => patch({ termMonths: e.target.value })}
            />
          </div>
        </div>
      </details>

      <div className="space-y-3 rounded-lg bg-subtle p-3.5">
        <Switch
          checked={form.autoRecord}
          onCheckedChange={autoRecord => patch({ autoRecord })}
          label="Record instalments automatically"
          description="Post an expense by itself each time this falls due, the way subscriptions do."
        />

        {form.autoRecord && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label>Paid from</Label>
            <Select value={form.paymentMode} onValueChange={v => patch({ paymentMode: v })}>
              <SelectTrigger><SelectValue placeholder="Payment mode" /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {error && <p className="text-footnote text-destructive-text" role="alert">{error}</p>}

      <Button type="submit" size="block">{submitLabel}</Button>
    </form>
  );
}
