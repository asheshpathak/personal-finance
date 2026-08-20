import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Info,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  TrendingUp,
  Undo2,
  Zap,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { Stat, StatRow } from '@/components/ui/stat';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useCurrency } from '@/context/CurrencyContext';
import { useFinances, type SubscriptionRecord } from '@/lib/useFinances';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { computeSpendTotals, toMonthlyEquivalent, type Frequency } from '@/lib/subscriptionTotals';
import { annualBurn, detectRecurring, subscriptionHealth } from '@/lib/recurring';
import { colorForName, tintForName } from '@/lib/chartTheme';
import {
  DAYS_OF_WEEK,
  DAYS_OF_MONTH,
  MONTHS,
  describePendingChange,
  formatDueDate,
  formatNextCharge,
  type DayOfWeek,
} from '@/lib/subscriptionDueDate';
import { PAYMENT_MODES } from '@/components/ExpenseForm';
import { fromDayKey, toDayKey } from '@/lib/dates';

/**
 * Recurring charges.
 *
 * The headline is the **annual** figure, not the monthly one. That is the whole
 * point of this screen: nine subscriptions at a few hundred each is invisible
 * month to month and startling once a year, and the annual total is reliably
 * the highest-shock-per-pixel number in this category of app.
 *
 * Two things here are derived rather than entered, and they are why the page is
 * worth more than a list:
 *
 *  · **Price drift** — the last charge came in above the price on record. Every
 *    forecast and budget line built on the old figure is now wrong in the same
 *    direction, silently.
 *  · **Dormant** — nothing has posted for well over a cycle. Either it was
 *    cancelled at the provider and is still reserving money in the plan, or it
 *    stopped charging and nobody noticed.
 */

const CATEGORIES = [
  'Streaming & Media',
  'Software & SaaS',
  'Cloud & Hosting',
  'Phone & Internet',
  'Utilities',
  'Insurance',
  'Fitness & Health',
  'News & Publications',
  'Gaming',
  'Food & Delivery',
  'Transport & Commute',
  'Finance & Banking',
  'Education & Learning',
  'Other',
];

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

interface FormState {
  name: string;
  amount: string;
  frequency: Frequency | '';
  category: string;
  dueDayOfWeek: DayOfWeek | '';
  dueDayOfMonth: string;
  dueMonth: string;
  autoRecord: boolean;
  paymentMode: string;
}

const emptyForm = (): FormState => ({
  name: '',
  amount: '',
  frequency: '',
  category: '',
  dueDayOfWeek: '',
  dueDayOfMonth: '',
  dueMonth: '',
  autoRecord: true,
  paymentMode: 'Bank Transfer',
});

/**
 * Defined at module scope, NOT inside the page component — a component declared
 * inline is a new type on every render, so React remounts the inputs and drops
 * focus on every keystroke.
 */
function SubscriptionForm({
  onSubmit,
  submitLabel,
  form,
  patch,
  error,
  /** Set when editing something whose current cycle has already been billed. */
  scheduleNotice,
}: {
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  form: FormState;
  patch: (next: Partial<FormState>) => void;
  error: string | null;
  scheduleNotice?: string | null;
}) {
  const handleFrequencyChange = (v: Frequency) => {
    // The due-date fields mean different things per cadence, so carrying a
    // stale one over would submit a day-of-month for a weekly subscription.
    patch({ frequency: v, dueDayOfWeek: '', dueDayOfMonth: '', dueMonth: '' });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 min-w-0">
      <div className="space-y-2">
        <Label htmlFor="sub-name">Name</Label>
        <Input
          id="sub-name"
          required
          value={form.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="Netflix, gym membership…"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sub-amount">Amount</Label>
        <Input
          id="sub-amount"
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          required
          value={form.amount}
          onChange={e => patch({ amount: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Frequency</Label>
        <Select value={form.frequency} onValueChange={v => handleFrequencyChange(v as Frequency)} required>
          <SelectTrigger><SelectValue placeholder="How often" /></SelectTrigger>
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

      {form.frequency === 'monthly' && (
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
          <p className="text-caption text-muted-foreground">
            A day past the end of a short month bills on its last day — the 31st becomes Feb 28.
          </p>
        </div>
      )}

      {form.frequency === 'yearly' && (
        <>
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
        </>
      )}

      {scheduleNotice && (
        <p className="flex gap-2 rounded-lg bg-subtle px-3.5 py-3 text-caption text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">{scheduleNotice}</span>
        </p>
      )}

      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={form.category} onValueChange={v => patch({ category: v })} required>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 rounded-lg bg-subtle p-3.5">
        <Switch
          checked={form.autoRecord}
          onCheckedChange={autoRecord => patch({ autoRecord })}
          label="Record automatically"
          description="Post an expense by itself each time this falls due."
        />

        {form.autoRecord && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label>Paid with</Label>
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

export default function Subscriptions() {
  const { formatMoney, formatRounded } = useCurrency();
  const { expenses, subscriptions, loading, ready, reload } = useFinances({ budgets: false });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const patch = (next: Partial<FormState>) => setForm(prev => ({ ...prev, ...next }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditId(null);
    setError(null);
  };

  const buildPayload = () => ({
    name: form.name,
    amount: Number(form.amount),
    frequency: form.frequency,
    category: form.category,
    autoRecord: form.autoRecord,
    paymentMode: form.paymentMode,
    dueDayOfWeek: form.frequency === 'weekly' ? form.dueDayOfWeek : undefined,
    dueDayOfMonth:
      form.frequency === 'monthly' || form.frequency === 'yearly' ? Number(form.dueDayOfMonth) : undefined,
    dueMonth: form.frequency === 'yearly' ? Number(form.dueMonth) : undefined,
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/subscriptions', buildPayload());
      setIsAddOpen(false);
      resetForm();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this subscription.');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    setError(null);
    try {
      await api.put(`/api/subscriptions/${editId}`, buildPayload());
      resetForm();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this subscription.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/subscriptions/${deleteId}`);
      reload();
    } catch (err) {
      console.error(err);
    }
  };

  const cancelPendingChange = async (id: string) => {
    try {
      await api.delete(`/api/subscriptions/${id}/pending-schedule`);
      reload();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (sub: SubscriptionRecord) => {
    setEditId(sub._id);
    setError(null);
    // A staged due-date change is what the schedule is *becoming*, so that is
    // what the form has to show. Loading the still-live schedule instead meant
    // that fixing a typo in the name re-submitted the old due date, the server
    // saw no change, and the pending move was silently thrown away.
    const schedule = sub.pendingSchedule ?? sub;
    setForm({
      name: sub.name,
      amount: String(sub.amount),
      frequency: schedule.frequency,
      category: sub.category,
      dueDayOfWeek: (schedule.dueDayOfWeek as DayOfWeek) ?? '',
      dueDayOfMonth: schedule.dueDayOfMonth ? String(schedule.dueDayOfMonth) : '',
      dueMonth: schedule.dueMonth ? String(schedule.dueMonth) : '',
      autoRecord: sub.autoRecord !== false,
      paymentMode: sub.paymentMode || 'Bank Transfer',
    });
  };

  const totals = useMemo(() => computeSpendTotals(subscriptions), [subscriptions]);
  const yearly = useMemo(() => annualBurn(subscriptions), [subscriptions]);

  const health = useMemo(
    () =>
      subscriptionHealth(
        subscriptions.map(s => ({ _id: s._id, name: s.name, amount: s.amount, frequency: s.frequency })),
        expenses,
        toDayKey()
      ),
    [subscriptions, expenses]
  );

  const healthById = useMemo(() => new Map(health.map(h => [h.subscriptionId, h])), [health]);
  const issues = useMemo(() => health.filter(h => h.dormant || h.priceDrift !== null), [health]);

  /**
   * Recurring payments the app has never been told about.
   *
   * Detected from manually recorded expenses, gated hard: three occurrences
   * minimum, a recognisable cadence, consistent pricing, and a confidence floor.
   * A false positive here asks somebody to cancel something that doesn't exist.
   */
  const undetected = useMemo(
    () =>
      detectRecurring(expenses, {
        known: subscriptions.map(s => s.name),
        today: toDayKey(),
      }).slice(0, 4),
    [expenses, subscriptions]
  );

  const editing = subscriptions.find(s => s._id === editId) ?? null;
  const sorted = useMemo(
    () => [...subscriptions].sort((a, b) => toMonthlyEquivalent(b) - toMonthlyEquivalent(a)),
    [subscriptions]
  );

  if (loading && !ready) {
    return (
      <Layout title="Subscriptions">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Subscriptions">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Subscriptions"
          lede="Everything that charges you on a schedule, and what it adds up to."
          action={
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus strokeWidth={2.5} />
              Add
            </Button>
          }
        />

        {subscriptions.length === 0 && undetected.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="No subscriptions tracked"
            body="Add the things that charge you on a schedule and they will post themselves on their due date — and the forecast will stop guessing about them."
            action={
              <Button size="lg" onClick={() => setIsAddOpen(true)}>
                <Plus strokeWidth={2.5} />
                Add a subscription
              </Button>
            }
          />
        ) : (
          <>
            {/* ── The annual figure ────────────────────────────────────── */}
            {subscriptions.length > 0 && (
              <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-7 min-w-0">
                <p className="text-overline uppercase text-faint">Every year, on repeat</p>
                <p className="mt-2 text-display tnum">{formatRounded(yearly)}</p>
                <p className="mt-1.5 text-subhead text-muted-foreground">
                  Across {subscriptions.length}{' '}
                  {subscriptions.length === 1 ? 'subscription' : 'subscriptions'} ·{' '}
                  {formatRounded(totals.monthly)} a month · {formatRounded(totals.daily)} a day.
                </p>

                <div className="mt-6">
                  <StatRow>
                    <Stat label="Monthly" value={formatRounded(totals.monthly)} hint="normalized" />
                    <Stat label="Weekly" value={formatRounded(totals.weekly)} hint="normalized" />
                    <Stat
                      label="Auto-recording"
                      value={String(subscriptions.filter(s => s.autoRecord !== false).length)}
                      hint={`of ${subscriptions.length}`}
                    />
                    <Stat
                      label="Needs a look"
                      value={String(issues.length)}
                      hint={issues.length === 0 ? 'all healthy' : 'price or activity'}
                      tone={issues.length > 0 ? 'warning' : 'default'}
                    />
                  </StatRow>
                </div>
              </section>
            )}

            {/* ── Things worth knowing ─────────────────────────────────── */}
            {issues.length > 0 && (
              <section className="min-w-0">
                <SectionHeader title="Worth a look" subtitle="Derived from what has actually been charged" />
                <div className="mt-3 flex flex-col gap-2">
                  {issues.map(item => (
                    <div
                      key={item.subscriptionId ?? item.name}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border px-4 py-3 min-w-0',
                        item.priceDrift ? 'border-warning-border bg-warning-tint' : 'border-border bg-card'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                          item.priceDrift ? 'bg-warning/15 text-warning-text' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {item.priceDrift ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <AlertTriangle className="h-4 w-4" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-subhead font-semibold">{item.name}</p>
                        <p className="text-footnote text-muted-foreground">
                          {item.priceDrift ? (
                            <>
                              Last charged {formatMoney(item.priceDrift.charged)}, but recorded at{' '}
                              {formatMoney(item.priceDrift.recorded)} —{' '}
                              <span className="font-semibold text-warning-text tnum">
                                {item.priceDrift.percent > 0 ? '+' : ''}
                                {Math.round(item.priceDrift.percent)}%
                              </span>
                              . Every plan built on the old price is now wrong.
                            </>
                          ) : (
                            <>
                              Nothing has posted for {item.daysSinceCharge} days — more than a full
                              cycle. Cancelled at the provider, or paused?
                            </>
                          )}
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0"
                        onClick={() => {
                          const sub = subscriptions.find(s => s._id === item.subscriptionId);
                          if (sub) openEdit(sub);
                        }}
                      >
                        Fix
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Recurring charges nobody told the app about ──────────── */}
            {undetected.length > 0 && (
              <section className="rounded-2xl border border-dashed border-primary-border bg-primary-tint/50 p-5 min-w-0">
                <SectionHeader
                  title={`${undetected.length} recurring ${undetected.length === 1 ? 'payment' : 'payments'} not tracked`}
                  subtitle="Found in your own history — three or more charges on a regular cadence"
                />

                <ul className="mt-4 flex flex-col gap-2">
                  {undetected.map(found => (
                    <li
                      key={found.key}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 min-w-0"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: colorForName(found.category) }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-subhead font-medium">{found.label}</span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {found.occurrences} charges, about every {Math.round(found.medianGap)} days ·{' '}
                          {formatRounded(found.annualCost)} a year
                          {found.priceIncrease && (
                            <span className="font-semibold text-warning-text">
                              {' '}· up {Math.round(found.priceIncrease.percent)}%
                            </span>
                          )}
                        </span>
                      </span>
                      <Button
                        variant="tinted"
                        size="sm"
                        className="flex-shrink-0"
                        onClick={() => {
                          setForm({
                            ...emptyForm(),
                            name: found.label,
                            amount: String(found.latestAmount),
                            frequency: found.frequency,
                            category: 'Other',
                            dueDayOfMonth:
                              found.frequency === 'monthly' || found.frequency === 'yearly'
                                ? String(fromDayKey(found.nextExpected).getDate())
                                : '',
                            dueMonth:
                              found.frequency === 'yearly'
                                ? String(fromDayKey(found.nextExpected).getMonth() + 1)
                                : '',
                            // Off by default: this is a guess about a pattern, and
                            // a guess must not start writing expenses by itself.
                            autoRecord: false,
                          });
                          setIsAddOpen(true);
                        }}
                      >
                        Track it
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── The list ─────────────────────────────────────────────── */}
            {sorted.length > 0 && (
              <section className="min-w-0">
                <SectionHeader title="All subscriptions" subtitle="Heaviest first, by monthly equivalent" />

                <div className="mt-3 flex flex-col gap-2.5">
                  {sorted.map(sub => {
                    const pendingNote = describePendingChange(sub.pendingSchedule, sub.pendingEffectiveFrom);
                    const auto = sub.autoRecord !== false;
                    const item = healthById.get(sub._id);

                    return (
                      <article
                        key={sub._id}
                        className="rounded-xl border border-border bg-card p-4 shadow-card min-w-0"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.7rem]"
                            style={{
                              backgroundColor: tintForName(sub.category),
                              color: colorForName(sub.category),
                            }}
                          >
                            <Repeat className="h-[1.05rem] w-[1.05rem]" />
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate text-row font-semibold">{sub.name}</span>
                              {auto && (
                                <Zap
                                  className="h-3 w-3 flex-shrink-0 text-primary"
                                  aria-label="Records itself on the due date"
                                />
                              )}
                            </p>
                            <p className="truncate text-footnote text-muted-foreground">
                              {sub.category} · {formatMoney(sub.amount)} {sub.frequency}
                            </p>
                          </div>

                          <div className="flex-shrink-0 text-right">
                            <p className="text-row font-semibold tnum">
                              {formatRounded(toMonthlyEquivalent(sub))}
                            </p>
                            <p className="text-caption text-muted-foreground">per month</p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-footnote text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarClock className="h-3.5 w-3.5 flex-shrink-0" />
                            {auto ? formatNextCharge(sub.nextDueDay) : 'Recorded manually'}
                          </span>
                          {sub.frequency !== 'daily' && <span>Due {formatDueDate(sub)}</span>}
                          {item?.daysSinceCharge !== null && item?.daysSinceCharge !== undefined && (
                            <span>Last charged {item.daysSinceCharge}d ago</span>
                          )}
                          {pendingNote && <Badge tone="warning" size="sm">Changing</Badge>}
                        </div>

                        {pendingNote && (
                          <div className="mt-3 rounded-lg border border-warning-border bg-warning-tint px-3.5 py-3">
                            <p className="flex gap-2 text-caption text-warning-text">
                              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                              <span className="min-w-0">{pendingNote}</span>
                            </p>
                            <button
                              type="button"
                              onClick={() => void cancelPendingChange(sub._id)}
                              className="tactile mt-2 inline-flex items-center gap-1.5 text-caption font-semibold text-warning-text"
                            >
                              <Undo2 className="h-3 w-3" />
                              Keep the current date
                            </button>
                          </div>
                        )}

                        <div className="mt-3.5 flex gap-2 border-t border-border pt-3.5">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(sub)}>
                            <Pencil />
                            Edit
                          </Button>
                          <Button
                            variant="destructive-soft"
                            size="sm"
                            className="flex-1"
                            onClick={() => setDeleteId(sub._id)}
                          >
                            <Trash2 />
                            Delete
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Add ────────────────────────────────────────────────────────── */}
      <Dialog open={isAddOpen} onOpenChange={open => { setIsAddOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add subscription</DialogTitle></DialogHeader>
          <SubscriptionForm
            onSubmit={handleAdd}
            submitLabel="Save subscription"
            form={form}
            patch={patch}
            error={error}
          />
        </DialogContent>
      </Dialog>

      {/* ── Edit ───────────────────────────────────────────────────────── */}
      <Dialog open={editing !== null} onOpenChange={open => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit subscription</DialogTitle></DialogHeader>
          <SubscriptionForm
            onSubmit={handleEdit}
            submitLabel="Update subscription"
            form={form}
            patch={patch}
            error={error}
            scheduleNotice={
              editing?.lastChargedDay
                ? 'Changing the due date takes effect from the next cycle — this one keeps the date it was already billed on.'
                : null
            }
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete subscription?"
        description="It stops billing. Charges it already recorded stay in your history — that money genuinely left."
        onConfirm={confirmDelete}
      />
    </Layout>
  );
}
