import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import {
  Coins,
  Copy,
  PiggyBank,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Layout, BackLink } from '@/components/layout/Layout';
import { listIncome, type IncomeSummary } from '@/lib/incomeSources';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { PageHeader, SectionHeader, Skeleton } from '@/components/ui/section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { useCurrency } from '@/context/CurrencyContext';
import { EXPENSE_CATEGORIES, INVESTMENT_CATEGORIES, SAVINGS_CATEGORIES } from '@/lib/expenseCategories';
import { toDateInputValue } from '@/components/ExpenseForm';
import { formatDueDate, type DayOfWeek } from '@/lib/subscriptionDueDate';
import type { Frequency } from '@/lib/subscriptionTotals';
import {
  SUBSCRIPTION_CATEGORY,
  periodDays,
  subscriptionCostForPeriod,
  type Allocation,
  type Budget,
  type BudgetSubscription,
} from '@/lib/budgetSections';
import { AllocationHint } from '@/components/budget/AllocationHint';
import { MissingCategories } from '@/components/budget/MissingCategories';
import { PlanReviewCard } from '@/components/budget/PlanReview';
import {
  buildCategoryStats,
  missingCategories,
  suggestionIndex,
  type IntelExpense,
  type Suggestion,
} from '@/lib/budgetIntel';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { budgetLabel } from '@/lib/snapshots';

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

/** How many planned lines a budget carries, for the copy picker. */
function lineCount(budget: Budget): number {
  return (
    budget.categories.length +
    (budget.investments?.length ?? 0) +
    (budget.savings?.length ?? 0) +
    (budget.subscriptions?.length ?? 0)
  );
}

const SECTION_COLOR = {
  expenses: 'hsl(var(--chart-1))',
  investments: 'hsl(var(--chart-5))',
  savings: 'hsl(var(--chart-3))',
  subscriptions: 'hsl(var(--chart-4))',
} as const;

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
  suggestions,
  money,
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
  /** What history says each category costs, keyed by category name. */
  suggestions: Map<string, Suggestion>;
  money: (value: number) => string;
}) {
  const patchRow = (index: number, patch: Partial<Allocation>) =>
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Every row this section has an opinion about, for the fill-all shortcut. */
  const suggestable = rows.filter(r => r.name && suggestions.has(r.name));
  const applyAll = () =>
    onRowsChange(
      rows.map(row => {
        const suggestion = row.name ? suggestions.get(row.name) : undefined;
        return suggestion ? { ...row, allocatedAmount: suggestion.amount } : row;
      })
    );

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
      <SectionHeader
        title={
          <span className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] text-white"
              style={{ backgroundColor: color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            {title}
          </span>
        }
        subtitle={blurb}
        action={
          <div className="text-right">
            <p className="text-overline uppercase text-faint">Total</p>
            <p className="mt-0.5 text-title-3 tnum">{total}</p>
          </div>
        }
      />

      {suggestable.length > 0 && (
        <Button type="button" variant="tinted" size="sm" className="mt-3" onClick={applyAll}>
          <Sparkles />
          Fill {suggestable.length} {suggestable.length === 1 ? 'line' : 'lines'} from history
        </Button>
      )}

      <div className="mt-4 space-y-4">
        {rows.length === 0 && (
          <p className="text-subhead text-muted-foreground">Nothing planned here yet.</p>
        )}

        {rows.map((row, index) => {
          // A category already used in this section would split one line in two.
          const taken = rows.filter((_, i) => i !== index).map(r => r.name);
          const available = options.filter(o => !taken.includes(o));
          // A row holding a value the section no longer offers keeps it
          // selectable, so the trigger never renders blank.
          if (row.name && !available.includes(row.name)) available.unshift(row.name);

          const suggestion = row.name ? suggestions.get(row.name) ?? null : null;

          return (
            <div key={index} className="min-w-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-caption">Category</Label>
                  <Select value={row.name} onValueChange={val => patchRow(index, { name: val })} required>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {available.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-caption">Amount</Label>
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
                  variant="destructive-soft"
                  size="icon"
                  className="w-full flex-shrink-0 sm:w-11"
                  onClick={() => onRowsChange(rows.filter((_, i) => i !== index))}
                  aria-label={`Remove ${row.name || 'allocation'}`}
                >
                  <Trash2 />
                  <span className="sm:hidden">Remove</span>
                </Button>
              </div>

              {/* The suggestion sits under the row it belongs to, not in a panel
                  elsewhere — the number and the evidence for it in one place. */}
              <AllocationHint
                suggestion={suggestion}
                current={row.allocatedAmount || 0}
                onApply={amount => patchRow(index, { allocatedAmount: amount })}
                money={money}
              />
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
          <Plus />
          {addLabel}
        </Button>

        {rows.length >= options.length && (
          <p className="text-caption text-muted-foreground">
            Every category in this section is already planned.
          </p>
        )}
      </div>
    </section>
  );
}

/** What the snapshots page hands over when you tap "plan the next one". */
interface Prefill {
  startDate: string;
  endDate: string;
  income: number;
  categories: Allocation[];
  investments: Allocation[];
  savings: Allocation[];
  subscriptions: BudgetSubscription[];
  from: string;
}

export default function BudgetFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { formatAmount, formatRounded } = useCurrency();
  const isEditing = Boolean(id);

  const prefill = (location.state as { prefill?: Prefill } | null)?.prefill ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(() =>
    isEditing ? '' : prefill?.startDate ?? defaultPeriod().start
  );
  const [endDate, setEndDate] = useState(() =>
    isEditing ? '' : prefill?.endDate ?? defaultPeriod().end
  );
  const [isActive, setIsActive] = useState(false);
  const [income, setIncome] = useState(() =>
    !isEditing && prefill?.income ? String(prefill.income) : ''
  );
  /**
   * The account's recorded income, for seeding this field.
   *
   * Seeded rather than bound: a budget stores the figure it was *written
   * against*, so a plan made in March keeps reading correctly after a raise in
   * June. Binding it live would silently rewrite the assumptions of every past
   * plan the moment someone updates their salary.
   */
  const [accountIncome, setAccountIncome] = useState<IncomeSummary | null>(null);
  const [incomeTouched, setIncomeTouched] = useState(false);
  const [expenses, setExpenses] = useState<Allocation[]>(() =>
    !isEditing && prefill && prefill.categories.length > 0 ? prefill.categories.map(toRow) : [emptyRow()]
  );
  const [investments, setInvestments] = useState<Allocation[]>(() =>
    !isEditing && prefill ? prefill.investments.map(toRow) : []
  );
  const [savings, setSavings] = useState<Allocation[]>(() =>
    !isEditing && prefill ? prefill.savings.map(toRow) : []
  );
  const [includedSubs, setIncludedSubs] = useState<BudgetSubscription[]>(() =>
    !isEditing && prefill ? prefill.subscriptions : []
  );

  /** Spending history, for the suggestions. Absent history simply means none. */
  const [history, setHistory] = useState<IntelExpense[]>([]);

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
        const [subs, budgetList, expenseHistory] = await Promise.all([
          api.get<Subscription[]>('/api/subscriptions').catch(() => [] as Subscription[]),
          // Editing can't proceed without this list. Creating only uses it for
          // the copy picker, so a failure there mustn't bounce you out.
          api.get<Budget[]>('/api/budgets').catch(err => {
            if (id) throw err;
            console.error(err);
            return [] as Budget[];
          }),
          // Suggestions are a bonus, never a blocker — no history just means no
          // hints, and the form works exactly as it did before.
          api.get<IntelExpense[]>('/api/expenses').catch(() => [] as IntelExpense[]),
        ]);
        if (cancelled) return;
        setSubscriptions(subs);
        setBudgets(budgetList);
        setHistory(expenseHistory);

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

    void load();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const days = startDate && endDate ? periodDays(startDate, endDate) : 30;

  // ── Suggestions ───────────────────────────────────────────────────────────
  //
  // Recomputed only when the history or the period length changes — not on
  // every keystroke. Six months of expenses is a few thousand rows at most, so
  // this stays well inside a frame and the hints feel instantaneous.
  const stats = useMemo(() => buildCategoryStats(history, 6), [history]);
  const suggestions = useMemo(() => suggestionIndex(stats, days), [stats, days]);

  /** Every category the plan already covers, in any section. */
  const plannedNames = useMemo(
    () =>
      [
        ...expenses.map(r => r.name),
        ...investments.map(r => r.name),
        ...savings.map(r => r.name),
        ...(includedSubs.length > 0 ? [SUBSCRIPTION_CATEGORY] : []),
      ].filter(Boolean),
    [expenses, investments, savings, includedSubs]
  );

  const missing = useMemo(
    () => missingCategories(stats, plannedNames, days),
    [stats, plannedNames, days]
  );

  /** Drops a suggested category into whichever section it belongs to. */
  const addSuggestion = (suggestion: Suggestion) => {
    const row: Allocation = { name: suggestion.category, allocatedAmount: suggestion.amount };
    const append = (rows: Allocation[]) =>
      // A blank scaffold row is replaced rather than left dangling above the
      // line just added.
      [...rows.filter(r => r.name), row];

    if (suggestion.group === 'investments') setInvestments(append);
    else if (suggestion.group === 'savings') setSavings(append);
    else setExpenses(append);
  };

  const addAllSuggestions = () => missing.forEach(addSuggestion);

  /**
   * Sets a line to a figure, adding it where the plan has no such line.
   *
   * Used by the review, whose most useful finding is usually a category missing
   * entirely — so "apply" has to be able to create as well as edit.
   */
  const applyToLine = (category: string, amount: number) => {
    const patch = (rows: Allocation[]) =>
      rows.map(r => (r.name === category ? { ...r, allocatedAmount: amount } : r));

    if (expenses.some(r => r.name === category)) return setExpenses(patch);
    if (investments.some(r => r.name === category)) return setInvestments(patch);
    if (savings.some(r => r.name === category)) return setSavings(patch);

    // Not planned anywhere: route it to the section its category belongs to.
    const row: Allocation = { name: category, allocatedAmount: amount };
    if ((INVESTMENT_CATEGORIES as readonly string[]).includes(category)) {
      setInvestments(rows => [...rows.filter(r => r.name), row]);
    } else if ((SAVINGS_CATEGORIES as readonly string[]).includes(category)) {
      setSavings(rows => [...rows.filter(r => r.name), row]);
    } else {
      setExpenses(rows => [...rows.filter(r => r.name), row]);
    }
  };

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
    setCopiedFrom(budgetLabel(source));
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
  useEffect(() => {
    let cancelled = false;
    listIncome()
      .then(({ summary }) => {
        if (cancelled) return;
        setAccountIncome(summary);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  /**
   * Fills the field once, from the account, when it is empty.
   *
   * Only when empty and only when untouched: a person who typed a number, or a
   * budget being edited that already carries one, must never have it replaced
   * by a background fetch landing a moment later.
   */
  useEffect(() => {
    if (incomeTouched || income !== '' || !accountIncome || accountIncome.empty) return;
    if (!days) return;
    const prorated = Math.round((accountIncome.monthly / 30.437) * days);
    if (prorated > 0) setIncome(String(prorated));
  }, [accountIncome, income, incomeTouched, days]);

  const incomeValue = Number(income) || 0;
  const unallocated = incomeValue - allocated;

  /** The draft, in the shape the reviewer reads. */
  const draft = useMemo(
    () => ({
      period: { start: startDate, end: endDate, days },
      income: incomeValue,
      spending: expenses.filter(r => r.name),
      investments: investments.filter(r => r.name),
      savings: savings.filter(r => r.name),
      subscriptions: includedSubs,
      totalAllocated: allocated,
    }),
    [startDate, endDate, days, incomeValue, expenses, investments, savings, includedSubs, allocated]
  );

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
      <Layout title="Budget">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  // Subscriptions get their own section, so offering it as a spending line too
  // would budget the same money twice.
  const expenseOptions =
    includedSubs.length > 0
      ? EXPENSE_CATEGORIES.filter(c => c !== SUBSCRIPTION_CATEGORY)
      : EXPENSE_CATEGORIES;

  return (
    <Layout title={isEditing ? 'Edit budget' : 'New budget'}>
      <div className="flex max-w-3xl flex-col gap-5 min-w-0">
        <BackLink to="/budgets" label="Budgets" />

        <PageHeader
          title={isEditing ? 'Edit budget' : 'New budget'}
          lede="Spending, investments, savings and subscriptions — each in its own section."
        />

        <form onSubmit={handleSave} className="flex flex-col gap-5">
          {prefill && (
            <p
              role="status"
              className="flex gap-2.5 rounded-xl border border-primary-border bg-primary-tint px-4 py-3 text-footnote"
            >
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <span className="min-w-0">
                Started from your <span className="font-semibold">{prefill.from}</span> snapshot,
                with the recommendations you accepted already applied. Change anything before saving.
              </span>
            </p>
          )}

          {/* ── Copy existing ───────────────────────────────────────────── */}
          {!isEditing && budgets.length > 0 && (
            <section className="rounded-2xl border border-dashed border-border bg-card p-5 min-w-0">
              <SectionHeader
                title={
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] bg-muted text-muted-foreground">
                      <Copy className="h-4 w-4" />
                    </span>
                    Start from an earlier one
                  </span>
                }
                subtitle="Copies the allocations. The period stays as you set it."
              />

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <Select value={copyFromId} onValueChange={setCopyFromId}>
                    <SelectTrigger aria-label="Budget to copy from">
                      <SelectValue placeholder="Select a previous budget" />
                    </SelectTrigger>
                    <SelectContent>
                      {budgets.map(b => (
                        <SelectItem key={b._id} value={b._id}>
                          {budgetLabel(b)} · {lineCount(b)} {lineCount(b) === 1 ? 'line' : 'lines'}
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
                  <Copy />
                  Copy
                </Button>
              </div>

              {copiedFrom && (
                <p className="mt-2.5 text-footnote text-primary" role="status">
                  Copied every allocation from {copiedFrom}. Edit the sections below before saving.
                </p>
              )}
            </section>
          )}

          {/* ── Period & income ─────────────────────────────────────────── */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
            <SectionHeader title="Period and income" />

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="budget-start">Start date</Label>
                <DatePicker
                  id="budget-start"
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Start of the period"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="budget-end">End date</Label>
                {/* min = start, so an end date before the start can't be picked
                    at all rather than being rejected on submit. */}
                <DatePicker
                  id="budget-end"
                  value={endDate}
                  onChange={setEndDate}
                  min={startDate}
                  placeholder="End of the period"
                />
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <Label htmlFor="budget-income" className="flex items-center gap-2">
                <Coins className="h-4 w-4" />
                Expected income
                <span className="font-normal text-faint">optional</span>
              </Label>
              <Input
                id="budget-income"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={income}
                onChange={e => { setIncome(e.target.value); setIncomeTouched(true); }}
              />
              {accountIncome && !accountIncome.empty ? (
                <p className="text-caption text-muted-foreground">
                  Filled in from the income on your account —{' '}
                  {formatRounded(accountIncome.monthly)} a month, prorated across {days} days.
                  Change it here to plan against a different figure; your account is not affected.
                  {accountIncome.conservativeMonthly < accountIncome.monthly && (
                    <>
                      {' '}
                      A lean month would be about{' '}
                      <button
                        type="button"
                        className="tactile font-semibold text-primary underline"
                        onClick={() => {
                          setIncome(String(Math.round((accountIncome.conservativeMonthly / 30.437) * days)));
                          setIncomeTouched(true);
                        }}
                      >
                        {formatRounded((accountIncome.conservativeMonthly / 30.437) * days)}
                      </button>
                      {' '}— worth planning against if the income is not guaranteed.
                    </>
                  )}
                </p>
              ) : (
                <p className="text-caption text-muted-foreground">
                  Set this and the app can show what's left once every section is funded.{' '}
                  <Link to="/settings" className="tactile font-semibold text-primary underline">
                    Record your income in Settings
                  </Link>{' '}
                  and it fills in by itself, everywhere.
                </p>
              )}
            </div>

            <div className="mt-4 border-t border-border pt-2">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
                label="Make this the active budget"
                description="Home and Plan measure against whichever budget is active."
              />
            </div>
          </section>

          {/* Placed above the sections deliberately: a hole in the plan is worth
              knowing about before you start tuning the lines already in it. */}
          <MissingCategories
            suggestions={missing}
            money={formatAmount}
            onAdd={addSuggestion}
            onAddAll={addAllSuggestions}
          />

          <AllocationSection
            title="Spending"
            blurb="Day-to-day expenses"
            color={SECTION_COLOR.expenses}
            Icon={Wallet}
            options={expenseOptions}
            rows={expenses}
            onRowsChange={setExpenses}
            total={formatRounded(expenseTotal)}
            addLabel="Add spending category"
            suggestions={suggestions}
            money={formatAmount}
          />

          <AllocationSection
            title="Investments"
            blurb="Money put to work"
            color={SECTION_COLOR.investments}
            Icon={TrendingUp}
            options={INVESTMENT_CATEGORIES}
            rows={investments}
            onRowsChange={setInvestments}
            total={formatRounded(investmentTotal)}
            addLabel="Add investment"
            suggestions={suggestions}
            money={formatAmount}
          />

          <AllocationSection
            title="Savings"
            blurb="Targets you're putting money aside for"
            color={SECTION_COLOR.savings}
            Icon={PiggyBank}
            options={SAVINGS_CATEGORIES}
            rows={savings}
            onRowsChange={setSavings}
            total={formatRounded(savingsTotal)}
            addLabel="Add savings target"
            suggestions={suggestions}
            money={formatAmount}
          />

          {/* ── Subscriptions ───────────────────────────────────────────── */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
            <SectionHeader
              title={
                <span className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.7rem] text-white"
                    style={{ backgroundColor: SECTION_COLOR.subscriptions }}
                  >
                    <Repeat className="h-4 w-4" />
                  </span>
                  Subscriptions
                </span>
              }
              subtitle={`Prorated across the ${days}-day period`}
              action={
                <div className="text-right">
                  <p className="text-overline uppercase text-faint">Total</p>
                  <p className="mt-0.5 text-title-3 tnum">{formatRounded(subscriptionTotal)}</p>
                </div>
              }
            />

            <div className="mt-4 space-y-2">
              {subscriptions.length === 0 ? (
                <p className="text-subhead text-muted-foreground">
                  No subscriptions tracked yet.{' '}
                  <Link to="/subscriptions" className="font-medium text-primary underline underline-offset-4">
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
                      className={cn(
                        'tactile flex min-h-[3.5rem] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5',
                        checked ? 'border-primary bg-primary-tint' : 'border-border hover:bg-subtle'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSubscription(sub)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border-strong'
                        )}
                      >
                        {checked && (
                          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
                            <path
                              d="M2.5 6.2 4.8 8.5 9.5 3.8"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-subhead font-medium">{sub.name}</span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {formatAmount(sub.amount)} · {sub.frequency}
                          {sub.frequency !== 'daily' && <> · due {formatDueDate(sub)}</>}
                        </span>
                      </span>

                      <span className="flex-shrink-0 text-right">
                        <span className="block text-subhead font-semibold tnum">
                          {formatAmount(subscriptionCostForPeriod(sub, days))}
                        </span>
                        <span className="block text-caption text-muted-foreground">this period</span>
                      </span>
                    </label>
                  );
                })
              )}

              {orphanedSubs.length > 0 && (
                <div className="pt-2">
                  <p className="mb-2 text-caption text-muted-foreground">
                    Planned earlier but no longer tracked as a subscription:
                  </p>
                  {orphanedSubs.map(sub => (
                    <div
                      key={subKey(sub)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 opacity-70"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-subhead font-medium">{sub.name}</span>
                        <span className="block text-caption text-muted-foreground">
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
            </div>
          </section>

          {/* ── A second opinion ────────────────────────────────────────── */}
          <PlanReviewCard plan={draft} onApply={applyToLine} />

          {/* ── Summary ─────────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-primary-border bg-primary-tint p-5 sm:p-6 min-w-0">
            <SectionHeader title="Plan summary" />

            <dl className="mt-4 space-y-2.5">
              {(
                [
                  ['Spending', expenseTotal, SECTION_COLOR.expenses],
                  ['Investments', investmentTotal, SECTION_COLOR.investments],
                  ['Savings', savingsTotal, SECTION_COLOR.savings],
                  ['Subscriptions', subscriptionTotal, SECTION_COLOR.subscriptions],
                ] as const
              ).map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-subhead">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    {label}
                  </dt>
                  <dd className="font-semibold tnum">{formatRounded(value)}</dd>
                </div>
              ))}

              <div className="flex items-center justify-between gap-3 border-t border-primary-border pt-3 text-subhead">
                <dt className="font-semibold">Total allocated</dt>
                <dd className="text-title-3 tnum">{formatRounded(allocated)}</dd>
              </div>

              {incomeValue > 0 && (
                <>
                  <div className="flex items-center justify-between gap-3 text-subhead">
                    <dt className="text-muted-foreground">Expected income</dt>
                    <dd className="font-semibold tnum">{formatRounded(incomeValue)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-subhead">
                    <dt
                      className={cn(
                        unallocated < 0 ? 'font-semibold text-destructive-text' : 'text-muted-foreground'
                      )}
                    >
                      {unallocated < 0 ? 'Over your income by' : 'Left unallocated'}
                    </dt>
                    <dd className={cn('font-bold tnum', unallocated < 0 && 'text-destructive-text')}>
                      {formatRounded(Math.abs(unallocated))}
                    </dd>
                  </div>
                  {unallocated > 0 && (
                    <div className="pt-1">
                      <Badge tone="positive" size="sm">
                        {Math.round((unallocated / incomeValue) * 100)}% of income unassigned
                      </Badge>
                    </div>
                  )}
                </>
              )}
            </dl>
          </section>

          {error && <p className="text-footnote text-destructive-text" role="alert">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="sm:flex-1"
              onClick={() => navigate('/budgets')}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" className="sm:flex-1" disabled={saving}>
              {saving ? 'Saving…' : isEditing ? 'Update budget' : 'Save budget'}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
