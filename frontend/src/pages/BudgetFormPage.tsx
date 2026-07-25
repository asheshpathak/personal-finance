import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Plus, Trash2, Wallet, TrendingUp, PiggyBank, Repeat, Coins, Copy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrency } from '@/context/CurrencyContext';
import { EXPENSE_CATEGORIES, INVESTMENT_CATEGORIES, SAVINGS_CATEGORIES } from '@/lib/expenseCategories';
import { toDateInputValue } from '@/components/ExpenseForm';
import { formatDueDate, type DayOfWeek } from '@/lib/subscriptionDueDate';
import type { Frequency } from '@/lib/subscriptionTotals';
import {
  SECTION_META,
  SUBSCRIPTION_CATEGORY,
  periodDays,
  subscriptionCostForPeriod,
  type Allocation,
  type Budget,
  type BudgetSubscription,
} from '@/lib/budgetSections';
import { api } from '@/lib/api';

interface Subscription {
  _id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  category: string;
  dueDayOfWeek?: DayOfWeek | null;
  dueDayOfMonth?: number | null;
  dueMonth?: number | null;
}

const emptyRow = (): Allocation => ({ name: '', allocatedAmount: 0 });

/** Strips subdocument ids so what's edited is exactly what gets sent back. */
const toRow = ({ name, allocatedAmount }: Allocation): Allocation => ({ name, allocatedAmount });

/** New budgets default to the current calendar month — the common case. */
function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

const sum = (rows: Allocation[]) => rows.reduce((acc, r) => acc + (r.allocatedAmount || 0), 0);

/** "Jul 1 – Jul 31, 2026" — how a budget is identified everywhere in the app. */
function formatPeriod({ startDate, endDate }: { startDate: string; endDate: string }): string {
  const start = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end = new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${start} – ${end}`;
}

/** How many planned lines a budget carries, for the copy picker. */
function lineCount(budget: Budget): number {
  return (
    budget.categories.length +
    (budget.investments?.length ?? 0) +
    (budget.savings?.length ?? 0) +
    (budget.subscriptions?.length ?? 0)
  );
}

/**
 * One editable section of the plan. Defined at module scope, NOT inside the page
 * component — a component declared inline is a new type on every render, which
 * remounts the inputs and drops focus on every keystroke.
 */
function AllocationSection({
  title,
  blurb,
  color,
  Icon,
  options,
  rows,
  onRowsChange,
  total,
  addLabel,
}: {
  title: string;
  blurb: string;
  color: string;
  Icon: LucideIcon;
  options: readonly string[];
  rows: Allocation[];
  onRowsChange: (rows: Allocation[]) => void;
  /** Pre-formatted so the section stays currency-agnostic. */
  total: string;
  addLabel: string;
}) {
  const patchRow = (index: number, patch: Partial<Allocation>) =>
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Card className="rounded-2xl border-2">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{blurb}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-base font-bold tabular-nums">{total}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">Nothing planned here yet.</p>
        )}

        {rows.map((row, index) => {
          // A category already used in this section would split one line in two.
          const taken = rows.filter((_, i) => i !== index).map(r => r.name);
          const available = options.filter(o => !taken.includes(o));
          // A row holding a value the section no longer offers keeps it
          // selectable, so the trigger never renders blank.
          if (row.name && !available.includes(row.name)) available.unshift(row.name);

          return (
            <div key={index} className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1 space-y-2 min-w-0">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <Select value={row.name} onValueChange={val => patchRow(index, { name: val })} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  inputMode="decimal"
                  value={row.allocatedAmount || ''}
                  onChange={e => patchRow(index, { allocatedAmount: Number(e.target.value) })}
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:w-9 sm:h-9 sm:p-0 sm:mb-[2px] flex-shrink-0 sm:self-end"
                onClick={() => onRowsChange(rows.filter((_, i) => i !== index))}
                aria-label={`Remove ${row.name || 'allocation'}`}
              >
                <Trash2 className="w-4 h-4 sm:mr-0 mr-2" />
                <span className="sm:hidden">Remove</span>
              </Button>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => onRowsChange([...rows, emptyRow()])}
          disabled={rows.length >= options.length}
        >
          <Plus className="w-4 h-4 mr-1" />
          {addLabel}
        </Button>

        {rows.length >= options.length && (
          <p className="text-xs text-muted-foreground">Every category in this section is already planned.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function BudgetFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatAmount } = useCurrency();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(() => (isEditing ? '' : defaultPeriod().start));
  const [endDate, setEndDate] = useState(() => (isEditing ? '' : defaultPeriod().end));
  const [isActive, setIsActive] = useState(false);
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState<Allocation[]>([emptyRow()]);
  const [investments, setInvestments] = useState<Allocation[]>([]);
  const [savings, setSavings] = useState<Allocation[]>([]);
  const [includedSubs, setIncludedSubs] = useState<BudgetSubscription[]>([]);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [copyFromId, setCopyFromId] = useState('');
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // Both lists are needed either way: subscriptions to pick from, and
        // existing budgets to copy from (or to load the one being edited).
        const [subs, budgetList] = await Promise.all([
          api.get<Subscription[]>('/api/subscriptions').catch(() => [] as Subscription[]),
          // Editing can't proceed without this list. Creating only uses it for
          // the copy picker, so a failure there mustn't bounce you out.
          api.get<Budget[]>('/api/budgets').catch(err => {
            if (id) throw err;
            console.error(err);
            return [] as Budget[];
          }),
        ]);
        if (cancelled) return;
        setSubscriptions(subs);
        setBudgets(budgetList);

        if (id) {
          const budget = budgetList.find(b => b._id === id);
          if (!budget) {
            navigate('/budgets');
            return;
          }
          setStartDate(toDateInputValue(budget.startDate));
          setEndDate(toDateInputValue(budget.endDate));
          setIsActive(budget.isActive);
          setIncome(budget.income ? String(budget.income) : '');
          setExpenses(budget.categories.length > 0 ? budget.categories.map(toRow) : [emptyRow()]);
          setInvestments((budget.investments ?? []).map(toRow));
          setSavings((budget.savings ?? []).map(toRow));
          setIncludedSubs(budget.subscriptions ?? []);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) navigate('/budgets');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const days = startDate && endDate ? periodDays(startDate, endDate) : 30;

  /**
   * Pulls every allocation out of a previous budget, leaving this one's period
   * and active flag alone — the dates are what makes the new budget new.
   */
  const handleCopyFrom = () => {
    const source = budgets.find(b => b._id === copyFromId);
    if (!source) return;

    setIncome(source.income ? String(source.income) : '');
    setExpenses(source.categories.length > 0 ? source.categories.map(toRow) : [emptyRow()]);
    setInvestments((source.investments ?? []).map(toRow));
    setSavings((source.savings ?? []).map(toRow));
    // Re-read each subscription from the live record where it still exists, so
    // a copied plan carries today's price rather than the old snapshot.
    setIncludedSubs(
      (source.subscriptions ?? []).map(sub => {
        const live = subscriptions.find(s => s._id === sub.subscriptionId || s.name === sub.name);
        return live
          ? { subscriptionId: live._id, name: live.name, amount: live.amount, frequency: live.frequency }
          : sub;
      })
    );
    setCopiedFrom(formatPeriod(source));
  };

  const subKey = (sub: { subscriptionId?: string | null; name: string }) =>
    sub.subscriptionId ?? sub.name;

  const isIncluded = (sub: Subscription) =>
    includedSubs.some(s => s.subscriptionId === sub._id || (!s.subscriptionId && s.name === sub.name));

  const toggleSubscription = (sub: Subscription) => {
    if (isIncluded(sub)) {
      setIncludedSubs(prev =>
        prev.filter(s => !(s.subscriptionId === sub._id || (!s.subscriptionId && s.name === sub.name)))
      );
      return;
    }

    // Snapshot the price so a past budget still reads correctly after the
    // subscription is repriced or cancelled.
    setIncludedSubs(prev => [
      ...prev,
      { subscriptionId: sub._id, name: sub.name, amount: sub.amount, frequency: sub.frequency },
    ]);
    // This section now covers subscriptions, so a lump-sum "Subscriptions"
    // spending line would budget the same money twice.
    setExpenses(prev => {
      const kept = prev.filter(r => r.name !== SUBSCRIPTION_CATEGORY);
      return kept.length > 0 ? kept : [emptyRow()];
    });
  };

  // Included subscriptions whose source record is gone — kept so an old budget
  // doesn't silently lose lines, but no longer toggleable.
  const orphanedSubs = includedSubs.filter(
    s => !subscriptions.some(live => live._id === s.subscriptionId || live.name === s.name)
  );

  const expenseTotal = sum(expenses);
  const investmentTotal = sum(investments);
  const savingsTotal = sum(savings);
  const subscriptionTotal = includedSubs.reduce((acc, s) => acc + subscriptionCostForPeriod(s, days), 0);
  const allocated = expenseTotal + investmentTotal + savingsTotal + subscriptionTotal;
  const incomeValue = Number(income) || 0;
  const unallocated = incomeValue - allocated;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (new Date(endDate) < new Date(startDate)) {
      setError('The end date must fall on or after the start date.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const payload = {
        startDate,
        endDate,
        isActive,
        income: incomeValue,
        // Blank rows are the form's scaffolding, not the user's plan.
        categories: expenses.filter(r => r.name),
        investments: investments.filter(r => r.name),
        savings: savings.filter(r => r.name),
        subscriptions: includedSubs,
      };
      if (isEditing) {
        await api.put(`/api/budgets/${id}`, payload);
      } else {
        await api.post('/api/budgets', payload);
      }
      navigate('/budgets');
    } catch (err) {
      console.error(err);
      setError('Could not save this budget. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="py-12 text-center text-muted-foreground">Loading budget...</div>
      </Layout>
    );
  }

  // Subscriptions get their own section, so offering it as a spending line too
  // would budget the same money twice.
  const expenseOptions = includedSubs.length > 0
    ? EXPENSE_CATEGORIES.filter(c => c !== SUBSCRIPTION_CATEGORY)
    : EXPENSE_CATEGORIES;

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8 max-w-3xl">
        <div className="flex flex-col gap-4">
          <Button variant="ghost" className="w-fit -ml-2 text-muted-foreground hover:text-foreground" asChild>
            <Link to="/budgets">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Budgets
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter">
              {isEditing ? 'Edit Budget' : 'Create New Budget'}
            </h1>
            <p className="text-muted-foreground mt-1">
              Plan spending, investments, savings and subscriptions — each in its own section.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-5 sm:gap-6">
          {/* ── Copy existing ───────────────────────────────────────────── */}
          {!isEditing && budgets.length > 0 && (
            <Card className="rounded-2xl border-2 border-dashed">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground">
                    <Copy className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-base">Copy existing</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Start from a previous budget's allocations, then change what you need.
                      The period above stays as you set it.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 min-w-0">
                    <Select value={copyFromId} onValueChange={setCopyFromId}>
                      <SelectTrigger aria-label="Budget to copy from">
                        <SelectValue placeholder="Select a previous budget" />
                      </SelectTrigger>
                      <SelectContent>
                        {budgets.map(b => (
                          <SelectItem key={b._id} value={b._id}>
                            {formatPeriod(b)} · {lineCount(b)} {lineCount(b) === 1 ? 'line' : 'lines'}
                            {b.isActive ? ' · Active' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-shrink-0 sm:w-32"
                    onClick={handleCopyFrom}
                    disabled={!copyFromId}
                  >
                    <Copy className="w-4 h-4 mr-1.5" />
                    Copy
                  </Button>
                </div>

                {copiedFrom && (
                  <p className="text-xs text-primary" role="status">
                    Copied every allocation from {copiedFrom}. Edit the sections below before saving.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Period & income ─────────────────────────────────────────── */}
          <Card className="rounded-2xl border-2">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Period &amp; income</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="budget-start">Start Date</Label>
                  <Input id="budget-start" type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="budget-end">End Date</Label>
                  <Input id="budget-end" type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget-income" className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-muted-foreground" />
                  Expected income
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="budget-income"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={income}
                  onChange={e => setIncome(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Set this to see what's left over once every section is funded.
                </p>
              </div>

              <label htmlFor="isActive" className="flex items-center gap-3 py-2 min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/[0.04] accent-primary [color-scheme:dark]"
                />
                <span className="text-sm font-medium leading-none">Set as Active Budget</span>
              </label>
            </CardContent>
          </Card>

          <AllocationSection
            title="Spending"
            blurb={SECTION_META.expenses.blurb}
            color={SECTION_META.expenses.color}
            Icon={Wallet}
            options={expenseOptions}
            rows={expenses}
            onRowsChange={setExpenses}
            total={formatAmount(expenseTotal)}
            addLabel="Add spending category"
          />

          <AllocationSection
            title="Investments"
            blurb="Gold, stocks, mutual funds, trading and the rest"
            color={SECTION_META.investments.color}
            Icon={TrendingUp}
            options={INVESTMENT_CATEGORIES}
            rows={investments}
            onRowsChange={setInvestments}
            total={formatAmount(investmentTotal)}
            addLabel="Add investment"
          />

          <AllocationSection
            title="Savings"
            blurb="Targets you're putting money aside for"
            color={SECTION_META.savings.color}
            Icon={PiggyBank}
            options={SAVINGS_CATEGORIES}
            rows={savings}
            onRowsChange={setSavings}
            total={formatAmount(savingsTotal)}
            addLabel="Add savings target"
          />

          {/* ── Subscriptions ───────────────────────────────────────────── */}
          <Card className="rounded-2xl border-2">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${SECTION_META.subscriptions.color} 18%, transparent)`,
                      color: SECTION_META.subscriptions.color,
                    }}
                  >
                    <Repeat className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-base">Subscriptions</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pick the recurring charges this budget should carry. Costs are prorated across
                      the {days}-day period.
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
                  <p className="text-base font-bold tabular-nums">{formatAmount(subscriptionTotal)}</p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              {subscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No subscriptions tracked yet.{' '}
                  <Link to="/subscriptions" className="text-primary underline underline-offset-4">
                    Add one
                  </Link>{' '}
                  to include it in a budget.
                </p>
              ) : (
                subscriptions.map(sub => {
                  const checked = isIncluded(sub);
                  return (
                    <label
                      key={sub._id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 min-h-[52px] cursor-pointer transition-colors ${
                        checked ? 'border-primary/50 bg-primary/[0.06]' : 'border-white/10 hover:bg-white/[0.03]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSubscription(sub)}
                        className="w-5 h-5 flex-shrink-0 rounded border-white/20 bg-white/[0.04] accent-primary [color-scheme:dark]"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-semibold">{sub.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatAmount(sub.amount)} · {sub.frequency}
                          {sub.frequency !== 'daily' && <> · due {formatDueDate(sub)}</>}
                        </span>
                      </span>
                      <span className="text-right flex-shrink-0">
                        <span className="block text-sm font-bold tabular-nums">
                          {formatAmount(subscriptionCostForPeriod(sub, days))}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">this period</span>
                      </span>
                    </label>
                  );
                })
              )}

              {orphanedSubs.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-2">
                    Planned earlier but no longer tracked as a subscription:
                  </p>
                  {orphanedSubs.map(sub => (
                    <div
                      key={subKey(sub)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2.5 opacity-70"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{sub.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatAmount(sub.amount)} · {sub.frequency}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIncludedSubs(prev => prev.filter(s => subKey(s) !== subKey(sub)))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Plan summary ────────────────────────────────────────────── */}
          <Card className="rounded-2xl border-2 border-primary/30 bg-primary/[0.04]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plan summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {([
                ['Spending', expenseTotal, SECTION_META.expenses.color],
                ['Investments', investmentTotal, SECTION_META.investments.color],
                ['Savings', savingsTotal, SECTION_META.savings.color],
                ['Subscriptions', subscriptionTotal, SECTION_META.subscriptions.color],
              ] as const).map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                    {label}
                  </span>
                  <span className="font-semibold tabular-nums">{formatAmount(value)}</span>
                </div>
              ))}

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10 text-sm">
                <span className="font-semibold">Total allocated</span>
                <span className="font-bold tabular-nums">{formatAmount(allocated)}</span>
              </div>

              {incomeValue > 0 && (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Expected income</span>
                    <span className="font-semibold tabular-nums">{formatAmount(incomeValue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className={unallocated < 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                      {unallocated < 0 ? 'Over your income by' : 'Left unallocated'}
                    </span>
                    <span className={`font-bold tabular-nums ${unallocated < 0 ? 'text-destructive' : ''}`}>
                      {formatAmount(Math.abs(unallocated))}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <Button type="button" variant="outline" className="rounded-xl sm:flex-1" onClick={() => navigate('/budgets')}>
              Cancel
            </Button>
            <Button type="submit" className="sm:flex-1 h-12" disabled={saving}>
              {saving ? 'Saving…' : isEditing ? 'Update Budget' : 'Save Budget'}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
