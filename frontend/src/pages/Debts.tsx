import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Landmark,
  Pencil,
  Plus,
  Scale,
  Trash2,
  TrendingDown,
  Undo2,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { Stat, StatRow } from '@/components/ui/stat';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { DebtForm, emptyDebtForm, type DebtFormState } from '@/components/debts/DebtForm';
import { PrepaymentDialog } from '@/components/debts/PrepaymentDialog';
import { useCurrency } from '@/context/CurrencyContext';
import { useDataRefresh } from '@/context/DataRefreshContext';
import { ApiError } from '@/lib/api';
import { formatDay, relativeDay, toDayKey } from '@/lib/dates';
import { colorForName, tintForName } from '@/lib/chartTheme';
import { describePendingChange } from '@/lib/subscriptionDueDate';
import {
  closeDebt,
  createDebt,
  debtTotals,
  deleteDebt,
  describeTerm,
  discardPendingSchedule,
  listDebts,
  rankDebts,
  removePrepayment,
  reopenDebt,
  updateDebt,
  type DebtRecord,
} from '@/lib/debts';
import { cn } from '@/lib/utils';

/**
 * What is owed.
 *
 * The headline is **what the debt costs per month in interest**, not the
 * balance. The balance is the number everybody already knows and the one that
 * moves slowest; the interest figure is the one nobody has ever calculated, it
 * is the actual cost of carrying the debt, and it is what decides which loan to
 * attack first. A page that leads with "you owe ₹52,00,000" tells someone
 * something they could have told you. A page that leads with "this is costing
 * you ₹41,000 a month in interest, of which ₹9,900 is the credit card" tells
 * them what to do on Monday.
 *
 * Two things here are derived rather than stored, and they are why this is
 * worth more than a list:
 *
 *  · **A debt that is growing.** When the payment does not cover the interest
 *    the balance rises every month and the loan has no end. It is the single
 *    most consequential fact a person can be shown about their money, and it is
 *    invisible on every statement.
 *  · **What a part payment would do.** Interest saved and months removed, before
 *    committing — see `PrepaymentDialog`.
 */

export default function Debts() {
  const { formatMoney, formatRounded } = useCurrency();
  const { refresh } = useDataRefresh();
  const today = toDayKey();

  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<DebtFormState>(() => emptyDebtForm(today));
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [prepayFor, setPrepayFor] = useState<DebtRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    try {
      setDebts(await listDebts());
      setLoadError(null);
    } catch (err) {
      console.error(err);
      setLoadError("Couldn't load your debts. Check your connection.");
    } finally {
      setReady(true);
    }
  };

  useEffect(() => { void load(); }, []);

  const patch = (next: Partial<DebtFormState>) => setForm(prev => ({ ...prev, ...next }));

  const resetForm = () => {
    setForm(emptyDebtForm(today));
    setEditId(null);
    setFormError(null);
  };

  const ranked = useMemo(() => rankDebts(debts), [debts]);
  const active = ranked.filter(d => d.status === 'active');
  const closed = ranked.filter(d => d.status === 'closed');
  const totals = useMemo(() => debtTotals(debts), [debts]);

  /**
   * The live warning while typing.
   *
   * Computed in the browser from the three fields that decide it, rather than
   * waiting for a round-trip: someone entering a credit card at 42% paying
   * ₹9,000 against ₹284,000 should learn before they press save, not after.
   */
  const growthWarning = useMemo(() => {
    if (form.kind === 'interest-free') return null;
    const balance = Number(form.openingBalance);
    const rate = Number(form.annualRate);
    const instalment = Number(form.emiAmount);
    if (!(balance > 0) || !(rate > 0) || !(instalment > 0)) return null;
    if (form.frequency !== 'monthly') return null;
    const monthlyInterest = (balance * rate) / 100 / 12;
    if (instalment > monthlyInterest) return null;
    return `At ${formatRounded(instalment)} a month against ${formatRounded(monthlyInterest)} of monthly interest, this balance grows rather than shrinks — by about ${formatRounded(monthlyInterest - instalment)} every month, forever. That is worth knowing now; you can still save it.`;
  }, [form.kind, form.openingBalance, form.annualRate, form.emiAmount, form.frequency, formatRounded]);

  const toBody = () => ({
    name: form.name.trim(),
    lender: form.lender.trim(),
    category: form.category,
    kind: form.kind,
    openingBalance: Number(form.openingBalance),
    balanceAsOf: form.balanceAsOf,
    annualRate: form.kind === 'interest-free' ? 0 : Number(form.annualRate) || 0,
    emiAmount: Number(form.emiAmount),
    frequency: form.frequency,
    dueDayOfWeek: form.dueDayOfWeek || null,
    dueDayOfMonth: form.dueDayOfMonth ? Number(form.dueDayOfMonth) : null,
    dueMonth: form.dueMonth ? Number(form.dueMonth) : null,
    principal: form.principal ? Number(form.principal) : 0,
    termMonths: form.termMonths ? Number(form.termMonths) : null,
    creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
    minimumFraction: form.minimumFraction ? Number(form.minimumFraction) / 100 : null,
    autoRecord: form.autoRecord,
    paymentMode: form.paymentMode,
    notes: form.notes.trim(),
  });

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      await createDebt(toBody());
      setIsAddOpen(false);
      resetForm();
      await load();
      // Instalments post as expenses, so every other screen's totals moved.
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that debt.');
    }
  };

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editId) return;
    setFormError(null);
    try {
      await updateDebt(editId, toBody());
      resetForm();
      await load();
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that change.');
    }
  };

  const openEdit = (debt: DebtRecord) => {
    setForm({
      name: debt.name,
      lender: debt.lender,
      category: debt.category,
      kind: debt.kind,
      openingBalance: String(debt.openingBalance),
      balanceAsOf: debt.balanceAsOf,
      annualRate: String(debt.annualRate),
      emiAmount: String(debt.emiAmount),
      frequency: debt.frequency,
      dueDayOfWeek: debt.dueDayOfWeek ?? '',
      dueDayOfMonth: debt.dueDayOfMonth ? String(debt.dueDayOfMonth) : '',
      dueMonth: debt.dueMonth ? String(debt.dueMonth) : '',
      principal: debt.principal ? String(debt.principal) : '',
      termMonths: debt.termMonths ? String(debt.termMonths) : '',
      creditLimit: debt.creditLimit ? String(debt.creditLimit) : '',
      minimumFraction: debt.minimumFraction ? String(debt.minimumFraction * 100) : '',
      autoRecord: debt.autoRecord,
      paymentMode: debt.paymentMode,
      notes: debt.notes,
    });
    setEditId(debt._id);
    setFormError(null);
  };

  const editing = editId ? debts.find(d => d._id === editId) ?? null : null;

  return (
    <Layout title="Debts">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Debts"
          lede="What is owed, what it costs to carry, and what a part payment would do about it."
          action={
            <Button onClick={() => { resetForm(); setIsAddOpen(true); }}>
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add a debt
            </Button>
          }
        />

        {loadError && (
          <p role="alert" className="rounded-xl bg-destructive-tint px-4 py-3 text-footnote text-destructive-text">
            {loadError}
          </p>
        )}

        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : debts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Nothing recorded yet"
            body="Add a loan or a card and the app can tell you what it actually costs you each month, when it ends, and what happens if you pay a lump sum into it."
            action={
              <Button onClick={() => { resetForm(); setIsAddOpen(true); }}>
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Add your first debt
              </Button>
            }
          />
        ) : (
          <>
            {/* ── The figures that decide what to do ─────────────────── */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
              <StatRow>
                <Stat
                  label="Costing you"
                  value={`${formatRounded(totals.monthlyInterest)}/mo`}
                  hint="in interest alone"
                  tone={totals.monthlyInterest > 0 ? 'negative' : 'default'}
                />
                <Stat
                  label="Total owed"
                  value={formatRounded(totals.balance)}
                  hint={`across ${totals.count} debt${totals.count === 1 ? '' : 's'}`}
                />
                <Stat
                  label="Instalments"
                  value={`${formatRounded(totals.monthlyOutgo)}/mo`}
                  hint="leaves before anything else"
                />
                <Stat
                  label="Debt free"
                  value={totals.lastPayoffDay ? formatDay(totals.lastPayoffDay) : '—'}
                  hint={
                    totals.growing.length > 0
                      ? 'never, while one is growing'
                      : totals.lastPayoffDay
                        ? 'if nothing changes'
                        : 'not projectable yet'
                  }
                  tone={totals.growing.length > 0 ? 'negative' : 'default'}
                />
              </StatRow>
            </section>

            {/* ── The one thing that outranks everything ─────────────── */}
            {totals.growing.length > 0 && (
              <section
                role="alert"
                className="rounded-2xl border border-destructive/25 bg-destructive-tint p-5 sm:p-6 min-w-0"
              >
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive-text" />
                  <div className="min-w-0">
                    <p className="text-headline text-destructive-text">
                      {totals.growing.length === 1
                        ? `${totals.growing[0]!.name} is growing, not shrinking`
                        : `${totals.growing.length} debts are growing, not shrinking`}
                    </p>
                    <div className="mt-2 space-y-1.5 text-subhead text-destructive-text/90">
                      {totals.growing.map(debt => (
                        <p key={debt._id}>
                          {debt.name}: paying {formatRounded(debt.monthlyCost)} a month against{' '}
                          {formatRounded(debt.monthlyInterestCost)} of interest, so the balance rises
                          about {formatRounded(debt.monthlyInterestCost - debt.monthlyCost)} every month.
                          Paying anything above {formatRounded(debt.monthlyInterestCost)} stops that.
                        </p>
                      ))}
                    </div>
                    <p className="mt-2 text-caption text-destructive-text/80">
                      This outranks every other question about your money. No budget fixes it and no
                      ordering of the other debts matters until it is dealt with.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* ── The debts ──────────────────────────────────────────── */}
            <section className="min-w-0">
              <SectionHeader
                title="Active"
                subtitle="Ordered by what each is costing you in interest, not by size."
              />
              <div className="mt-4 space-y-3">
                {active.map(debt => (
                  <DebtCard
                    key={debt._id}
                    debt={debt}
                    expanded={expandedId === debt._id}
                    onToggle={() => setExpandedId(expandedId === debt._id ? null : debt._id)}
                    onEdit={() => openEdit(debt)}
                    onDelete={() => setDeleteId(debt._id)}
                    onPrepay={() => setPrepayFor(debt)}
                    onClose={async () => { await closeDebt(debt._id); await load(); refresh(); }}
                    onDiscardPending={async () => { await discardPendingSchedule(debt._id); await load(); }}
                    onRemovePrepayment={async id => { await removePrepayment(debt._id, id); await load(); refresh(); }}
                    formatMoney={formatMoney}
                    formatRounded={formatRounded}
                  />
                ))}
              </div>
            </section>

            {closed.length > 0 && (
              <section className="min-w-0">
                <SectionHeader title="Cleared" subtitle="Kept for the record. The payments stay in your history." />
                <div className="mt-4 space-y-2">
                  {closed.map(debt => (
                    <div
                      key={debt._id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 min-w-0"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-positive-tint text-positive-text">
                          <Check className="h-4 w-4" strokeWidth={2.5} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-row font-medium">{debt.name}</p>
                          <p className="truncate text-caption text-muted-foreground">
                            Cleared {debt.closedOn ? formatDay(debt.closedOn) : ''}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => { await reopenDebt(debt._id); await load(); refresh(); }}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        Reopen
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <Dialog open={isAddOpen} onOpenChange={open => { setIsAddOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Add a debt</DialogTitle></DialogHeader>
          <DebtForm
            form={form}
            patch={patch}
            onSubmit={handleCreate}
            submitLabel="Add debt"
            error={formError}
            today={today}
            growthWarning={growthWarning}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editId !== null} onOpenChange={open => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit {editing?.name}</DialogTitle></DialogHeader>
          <DebtForm
            form={form}
            patch={patch}
            onSubmit={handleUpdate}
            submitLabel="Save changes"
            error={formError}
            today={today}
            growthWarning={growthWarning}
            scheduleNotice={
              editing?.lastChargedDay
                ? 'A change to the due date takes effect from the next cycle. This one has already been billed on the old date, and moving it now would either charge twice or skip a month.'
                : null
            }
          />
        </DialogContent>
      </Dialog>

      <PrepaymentDialog
        debt={prepayFor}
        open={prepayFor !== null}
        onOpenChange={open => { if (!open) setPrepayFor(null); }}
        onSaved={async () => { await load(); refresh(); }}
      />

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete this debt?"
        description="The instalments already recorded stay in your spending history — that money genuinely left your account. This only stops future ones."
        onConfirm={async () => {
          if (!deleteId) return;
          await deleteDebt(deleteId);
          setDeleteId(null);
          await load();
          refresh();
        }}
      />
    </Layout>
  );
}

// ── One debt ────────────────────────────────────────────────────────────────

function DebtCard({
  debt,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onPrepay,
  onClose,
  onDiscardPending,
  onRemovePrepayment,
  formatMoney,
  formatRounded,
}: {
  debt: DebtRecord;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPrepay: () => void;
  onClose: () => void | Promise<void>;
  onDiscardPending: () => void | Promise<void>;
  onRemovePrepayment: (id: string) => void | Promise<void>;
  formatMoney: (n: number) => string;
  formatRounded: (n: number) => string;
}) {
  const accent = colorForName(debt.name);
  const tint = tintForName(debt.name);
  const progress = debt.paidOffFraction;
  const pending = describePendingChange(debt.pendingSchedule, debt.pendingEffectiveFrom);

  return (
    <article className="rounded-2xl border border-border bg-card shadow-card min-w-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
        <span
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.7rem]"
          style={{ background: tint, color: accent }}
          aria-hidden="true"
        >
          <Landmark className="h-[1.05rem] w-[1.05rem]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-headline truncate">{debt.name}</h3>
            <Badge tone="neutral" size="sm">{debt.category}</Badge>
            {debt.negativelyAmortizing && (
              <Badge tone="negative" size="sm">
                <AlertTriangle />
                Growing
              </Badge>
            )}
            {debt.utilization !== null && debt.utilization > 0.75 && (
              <Badge tone="warning" size="sm">{Math.round(debt.utilization * 100)}% of limit</Badge>
            )}
            {!debt.autoRecord && <Badge tone="neutral" size="sm">Manual</Badge>}
          </div>

          {debt.lender && (
            <p className="mt-0.5 truncate text-caption text-muted-foreground">{debt.lender}</p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Figure label="Balance" value={formatRounded(debt.balance)} />
            <Figure
              label="Interest cost"
              value={`${formatRounded(debt.monthlyInterestCost)}/mo`}
              tone={debt.negativelyAmortizing ? 'negative' : 'default'}
            />
            <Figure
              label="Instalment"
              value={`${formatMoney(debt.emiAmount)}`}
              hint={debt.annualRate > 0 ? `${debt.annualRate}% a year` : 'no interest'}
            />
            <Figure
              label="Paid off"
              value={
                debt.negativelyAmortizing
                  ? 'Never'
                  : debt.payoffDay
                    ? formatDay(debt.payoffDay)
                    : '—'
              }
              hint={
                debt.negativelyAmortizing
                  ? 'at this payment'
                  : debt.periodsRemaining > 0
                    ? describeTerm(debt.periodsRemaining, debt.frequency)
                    : undefined
              }
              tone={debt.negativelyAmortizing ? 'negative' : 'default'}
            />
          </div>

          {/* Progress only when the original figure is known — a bar stuck at
              zero for a nearly-paid loan is worse than no bar. */}
          {progress !== null && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max(2, progress * 100)}%`, background: accent }}
                />
              </div>
              <p className="mt-1.5 text-caption text-muted-foreground">
                {Math.round(progress * 100)}% of the original {formatRounded(debt.principal)} repaid
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
            {debt.nextDueDay && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Next {relativeDay(debt.nextDueDay)}
              </span>
            )}
            {debt.interestRemaining !== null && debt.interestRemaining > 0 && (
              <span>{formatRounded(debt.interestRemaining)} of interest still to pay</span>
            )}
            {debt.minimumDue > 0 && debt.emiAmount < debt.minimumDue && (
              <span className="text-warning-text">
                Below the {formatRounded(debt.minimumDue)} minimum due
              </span>
            )}
          </div>

          {pending && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-info-tint px-3 py-2 text-caption text-info-text">
              <span className="min-w-0">{pending}</span>
              <button
                type="button"
                onClick={() => void onDiscardPending()}
                className="tactile font-semibold underline"
              >
                Undo
              </button>
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap gap-2 sm:flex-col">
          <Button size="sm" onClick={onPrepay}>
            <TrendingDown className="h-3.5 w-3.5" />
            Part payment
          </Button>
          <Button variant="secondary" size="sm" onClick={onToggle}>
            <Scale className="h-3.5 w-3.5" />
            {expanded ? 'Hide' : 'Detail'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
          {debt.prepayments.length > 0 && (
            <div className="min-w-0">
              <p className="text-overline uppercase text-faint">Part payments</p>
              <ul className="mt-2 divide-y divide-border">
                {[...debt.prepayments].sort((a, b) => (a.day < b.day ? 1 : -1)).map(prepayment => (
                  <li key={prepayment._id} className="flex items-center justify-between gap-3 py-2.5 min-w-0">
                    <div className="min-w-0">
                      <p className="truncate text-subhead font-medium">
                        {formatMoney(prepayment.amount)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {prepayment.effect === 'reduce-tenure' ? 'finish sooner' : 'lower instalment'}
                        </span>
                      </p>
                      <p className="truncate text-caption text-muted-foreground">
                        {formatDay(prepayment.day)}
                        {!prepayment.recorded && ' — planned, not yet paid'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove this part payment"
                      onClick={() => void onRemovePrepayment(prepayment._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {debt.rateChanges.length > 0 && (
            <div className="min-w-0">
              <p className="text-overline uppercase text-faint">Rate history</p>
              <p className="mt-1.5 text-subhead text-muted-foreground">
                {[...debt.rateChanges]
                  .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
                  .map(change => `${change.annualRate}% from ${formatDay(change.effectiveFrom)}`)
                  .join(', then ')}
              </p>
            </div>
          )}

          <div className="min-w-0">
            <p className="text-overline uppercase text-faint">Anchored at</p>
            <p className="mt-1.5 text-subhead text-muted-foreground">
              {formatRounded(debt.openingBalance)} outstanding on {formatDay(debt.balanceAsOf)}.
              Everything above is replayed forward from there, so correcting this figure corrects
              every projection at once.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void onClose()}>
              <Check className="h-3.5 w-3.5" />
              Mark as cleared
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive-text" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function Figure({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: 'default' | 'negative';
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-overline uppercase text-faint">{label}</p>
      <p className={cn('mt-0.5 truncate text-row font-semibold tnum', tone === 'negative' && 'text-destructive-text')}>
        {value}
      </p>
      {hint && <p className="truncate text-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}
