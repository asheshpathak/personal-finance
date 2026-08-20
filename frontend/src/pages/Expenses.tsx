import { useMemo, useState } from 'react';
import { Plus, Receipt, Search, SlidersHorizontal, X } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/section';
import { SegmentedButton } from '@/components/ui/segmented';
import { Stat, StatRow } from '@/components/ui/stat';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { ExpenseList, type ExpenseItem } from '@/components/ExpenseList';
import { ExpenseEditDialog } from '@/components/ExpenseEditDialog';
import { ExpenseRangeFilter } from '@/components/ExpenseRangeFilter';
import { useCurrency } from '@/context/CurrencyContext';
import { useQuickAdd } from '@/context/QuickAddContext';
import { useFinances } from '@/lib/useFinances';
import { api } from '@/lib/api';
import { defaultRangeFilter, describeRange, filterByRange, type RangeFilter } from '@/lib/expenseRange';
import { cn } from '@/lib/utils';

/**
 * Everything recorded.
 *
 * The addition that matters most here is **search**. Every chart in this app
 * answers a question somebody designed it to answer; "what did I spend at that
 * place near the office in March" is not one of them, and it is the single most
 * common thing a person actually wants from a transaction history. A filter row
 * cannot substitute for it — you have to already know the category.
 */
export default function Expenses() {
  const { formatRounded } = useCurrency();
  const { openQuickAdd } = useQuickAdd();
  const { expenses, loading, ready, error, reload } = useFinances({
    budgets: false,
    subscriptions: false,
  });

  const [range, setRange] = useState<RangeFilter>(() => defaultRangeFilter('1M'));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [editing, setEditing] = useState<ExpenseItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  /** Categories present in the data, most-used first — so the chips a reader
   *  wants are the ones they see. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const expense of expenses) {
      counts.set(expense.category, (counts.get(expense.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [expenses]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return filterByRange(expenses, range).filter(expense => {
      if (category && expense.category !== category) return false;
      if (!needle) return true;
      // Searches the note, the category and the payment mode together. Three
      // separate fields would mean the reader has to know which one holds the
      // word they remember — and they don't.
      return (
        (expense.description ?? '').toLowerCase().includes(needle) ||
        expense.category.toLowerCase().includes(needle) ||
        expense.paymentMode.toLowerCase().includes(needle)
      );
    });
  }, [expenses, range, query, category]);

  const total = useMemo(() => filtered.reduce((sum, e) => sum + e.amount, 0), [filtered]);
  const average = filtered.length > 0 ? total / filtered.length : 0;
  const largest = useMemo(
    () => filtered.reduce((best, e) => (best === null || e.amount > best.amount ? e : best), null as ExpenseItem | null),
    [filtered]
  );

  const filtering = Boolean(query.trim()) || category !== null;

  const removeExpense = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/expenses/${deleteId}`);
      reload();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading && !ready) {
    return (
      <Layout title="Activity">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Activity">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Activity"
          lede="Everything you've recorded, newest first."
          action={
            // Hidden on touch: the tab bar's action button is two inches from
            // the thumb and does the same thing. Two entry points to one flow
            // on one screen is clutter, not convenience.
            <Button className="hidden md:inline-flex" onClick={() => openQuickAdd()}>
              <Plus strokeWidth={2.5} />
              Record
            </Button>
          }
        />

        {error && (
          <p role="alert" className="rounded-xl bg-destructive-tint px-4 py-3 text-footnote text-destructive-text">
            {error}
          </p>
        )}

        {expenses.length === 0 && ready ? (
          <EmptyState
            icon={Receipt}
            title="Nothing here yet"
            body="Every total, chart and forecast in this app is built from what you record. One payment is enough to start."
            action={
              <Button size="lg" onClick={() => openQuickAdd()}>
                <Plus strokeWidth={2.5} />
                Record a payment
              </Button>
            }
          />
        ) : (
          <>
            {/* ── Search ───────────────────────────────────────────────── */}
            <div className="flex gap-2 min-w-0">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search notes, categories, methods…"
                  aria-label="Search payments"
                  className="pl-10 pr-10"
                  type="search"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="tactile absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-faint hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <Button
                variant={category ? 'tinted' : 'outline'}
                size="icon"
                onClick={() => setFiltersOpen(open => !open)}
                aria-expanded={filtersOpen}
                aria-label="Filter by category"
              >
                <SlidersHorizontal />
              </Button>
            </div>

            {/* ── Period ───────────────────────────────────────────────── */}
            <ExpenseRangeFilter value={range} onChange={setRange} scope="all" />

            {/* ── Category chips ───────────────────────────────────────── */}
            {filtersOpen && categories.length > 0 && (
              <div className="rounded-xl bg-card border border-border p-3 min-w-0">
                <p className="text-overline uppercase text-faint">Category</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories.slice(0, 18).map(name => (
                    <SegmentedButton
                      key={name}
                      size="sm"
                      selected={category === name}
                      onClick={() => setCategory(current => (current === name ? null : name))}
                    >
                      {name}
                    </SegmentedButton>
                  ))}
                </div>
              </div>
            )}

            {/* ── The read-out ─────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-card shadow-card p-5 min-w-0">
              <StatRow>
                <Stat
                  label={describeRange(range)}
                  value={formatRounded(total)}
                  hint={`${filtered.length} ${filtered.length === 1 ? 'payment' : 'payments'}`}
                />
                <Stat label="Average" value={formatRounded(average)} hint="per payment" />
                <Stat
                  label="Largest"
                  value={largest ? formatRounded(largest.amount) : '—'}
                  hint={largest ? (largest.description || largest.category) : 'nothing in range'}
                />
              </StatRow>
            </div>

            {/* ── Active filters ───────────────────────────────────────── */}
            {filtering && (
              <div className="flex flex-wrap items-center gap-2">
                {category && (
                  <Badge tone="primary" size="lg" className="gap-1.5">
                    {category}
                    <button
                      type="button"
                      onClick={() => setCategory(null)}
                      aria-label={`Clear ${category} filter`}
                      className="tactile -mr-1 flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/15"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {query.trim() && (
                  <Badge tone="neutral" size="lg">“{query.trim()}”</Badge>
                )}
                <button
                  type="button"
                  onClick={() => { setQuery(''); setCategory(null); }}
                  className="tactile text-footnote font-semibold text-primary"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* ── The list ─────────────────────────────────────────────── */}
            {filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nothing matches"
                body={
                  filtering
                    ? 'Try a different word, or widen the period.'
                    : 'No payments were recorded in this period.'
                }
                action={
                  filtering ? (
                    <Button variant="outline" onClick={() => { setQuery(''); setCategory(null); }}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className={cn('rounded-2xl border border-border bg-card shadow-card px-4 py-3 sm:px-5 min-w-0')}>
                <ExpenseList expenses={filtered} onOpen={setEditing} />
              </div>
            )}
          </>
        )}
      </div>

      <ExpenseEditDialog
        expense={editing}
        onOpenChange={open => { if (!open) setEditing(null); }}
        onSaved={reload}
        onDelete={setDeleteId}
      />

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete this payment?"
        description="It will be removed permanently, and every total that includes it will change."
        onConfirm={removeExpense}
      />
    </Layout>
  );
}
