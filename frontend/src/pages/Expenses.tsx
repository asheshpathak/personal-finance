import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, CreditCard, Banknote, Landmark, Pencil, Trash2, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { api } from '@/lib/api';
import { ExpenseForm, emptyExpenseForm, toDateInputValue } from '@/components/ExpenseForm';
import type { ExpenseFormValues } from '@/components/ExpenseForm';

interface Expense {
  _id: string;
  amount: number;
  category: string;
  paymentMode: string;
  description: string;
  date: string;
  createdAt?: string;
}

/** Newest first, by expense day then by when it was recorded. Same-day entries
 *  are stored at local noon, so `date` alone ties — createdAt breaks it. */
function byRecency(a: Expense, b: Expense): number {
  const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (byDate !== 0) return byDate;
  return new Date(b.createdAt ?? b.date).getTime() - new Date(a.createdAt ?? a.date).getTime();
}

type FilterKey = '1D' | '3D' | '5D' | '1W' | '1M' | 'ALL';

const FILTERS: { label: string; key: FilterKey; days: number | null }[] = [
  { label: '1D',  key: '1D',  days: 1   },
  { label: '3D',  key: '3D',  days: 3   },
  { label: '5D',  key: '5D',  days: 5   },
  { label: '1W',  key: '1W',  days: 7   },
  { label: '1M',  key: '1M',  days: 30  },
  { label: 'All', key: 'ALL', days: null },
];

export default function Expenses() {
  const { formatAmount } = useCurrency();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');

  // Add / Edit form state
  const [isAddOpen, setIsAddOpen]   = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editId, setEditId]         = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseFormValues>(emptyExpenseForm);
  const patchForm = (patch: Partial<ExpenseFormValues>) => setForm(prev => ({ ...prev, ...patch }));
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchExpenses = async () => {
    try {
      setExpenses(await api.get<Expense[]>('/api/expenses'));
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchExpenses(); }, []);

  const resetForm = () => {
    setForm(emptyExpenseForm());
    setEditId(null);
  };

  // Send the date as local noon so the stored UTC instant can't slip to the
  // adjacent day for users far from UTC.
  const toPayload = (values: ExpenseFormValues) => ({
    amount: Number(values.amount),
    category: values.category,
    paymentMode: values.paymentMode,
    description: values.description,
    date: new Date(`${values.date}T12:00:00`).toISOString(),
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/expenses', toPayload(form));
      setIsAddOpen(false); resetForm(); fetchExpenses();
    } catch (err) { console.error(err); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    try {
      await api.put(`/api/expenses/${editId}`, toPayload(form));
      setIsEditOpen(false); resetForm(); fetchExpenses();
    } catch (err) { console.error(err); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/expenses/${deleteId}`);
      fetchExpenses();
    } catch (err) { console.error(err); }
  };

  const openEdit = (exp: Expense) => {
    setEditId(exp._id);
    setForm({
      amount: exp.amount.toString(),
      category: exp.category,
      paymentMode: exp.paymentMode,
      description: exp.description || '',
      date: toDateInputValue(exp.date),
    });
    setIsEditOpen(true);
  };

  const filteredExpenses = (() => {
    const filter = FILTERS.find(f => f.key === activeFilter)!;
    const list = filter.days
      ? expenses.filter(e => {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - filter.days!);
          cutoff.setHours(0, 0, 0, 0);
          return new Date(e.date) >= cutoff;
        })
      : expenses;
    return [...list].sort(byRecency);
  })();

  const totalFiltered = filteredExpenses.reduce((s, e) => s + e.amount, 0);

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter">Expenses</h1>
            <p className="text-muted-foreground mt-1">Full history of all your recorded expenses.</p>
          </div>

          <div className="flex gap-3 flex-shrink-0">
            {/* Add dialog */}
            <Dialog open={isAddOpen} onOpenChange={open => { setIsAddOpen(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button className="rounded-xl px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" /> Add Expense
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] rounded-2xl">
                <DialogHeader><DialogTitle>Add New Expense</DialogTitle></DialogHeader>
                <ExpenseForm values={form} onChange={patchForm} onSubmit={handleAdd} submitLabel="Save Expense" showShortcuts />
              </DialogContent>
            </Dialog>

            {/* Edit dialog (opened programmatically) */}
            <Dialog open={isEditOpen} onOpenChange={open => { setIsEditOpen(open); if (!open) resetForm(); }}>
              <DialogContent className="sm:max-w-[425px] rounded-2xl">
                <DialogHeader><DialogTitle>Edit Expense</DialogTitle></DialogHeader>
                <ExpenseForm values={form} onChange={patchForm} onSubmit={handleEdit} submitLabel="Update Expense" />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <Card className="rounded-2xl p-4 sm:p-5 border shadow-sm min-w-0">
            <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">Total (all time)</p>
            <p className="text-lg sm:text-2xl font-bold tracking-tight tabular-nums break-words">{formatAmount(expenses.reduce((s, e) => s + e.amount, 0))}</p>
          </Card>
          <Card className="rounded-2xl p-4 sm:p-5 border shadow-sm min-w-0">
            <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">Showing period</p>
            <p className="text-lg sm:text-2xl font-bold tracking-tight tabular-nums break-words">{formatAmount(totalFiltered)}</p>
          </Card>
          <Card className="col-span-2 sm:col-span-1 rounded-2xl p-4 sm:p-5 border shadow-sm min-w-0">
            <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">Transactions</p>
            <p className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 tabular-nums">
              <Receipt className="w-5 h-5 text-muted-foreground" />
              {filteredExpenses.length}
            </p>
          </Card>
        </div>

        {/* Filter + Table */}
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-base font-semibold text-muted-foreground">All Transactions</h2>
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  className={cn(
                    'rounded-lg h-11 md:h-9 px-4 text-xs font-semibold transition-all duration-150',
                    activeFilter === f.key
                      ? 'bg-foreground text-background shadow-sm'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop Table */}
          <Card className="border shadow-sm bg-card rounded-2xl overflow-hidden hidden lg:block">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-muted">
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Description</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Category</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider hidden xl:table-cell">Method</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      No expenses in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredExpenses.map(expense => (
                    <TableRow key={expense._id} className="border-b border-muted/50 hover:bg-muted/20 transition-colors">
                      <TableCell className="font-medium text-muted-foreground whitespace-nowrap">
                        {new Date(expense.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </TableCell>
                      <TableCell className="font-semibold">{expense.description || expense.category}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                          {expense.category}
                        </span>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex items-center gap-2 text-muted-foreground whitespace-nowrap">
                          {expense.paymentMode === 'Credit Card' ? <CreditCard className="w-4 h-4" /> :
                           expense.paymentMode === 'Cash'        ? <Banknote   className="w-4 h-4" /> :
                                                                   <Landmark   className="w-4 h-4" />}
                          <span className="text-sm">{expense.paymentMode}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold whitespace-nowrap">
                        {formatAmount(expense.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" onClick={() => openEdit(expense)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(expense._id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile Card List */}
          <div className="lg:hidden space-y-3">
            {filteredExpenses.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground rounded-2xl border bg-card">No expenses in this period.</div>
            ) : (
              filteredExpenses.map(expense => (
                <Card key={expense._id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{expense.description || expense.category}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(expense.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                          {expense.category}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          {expense.paymentMode === 'Credit Card' ? <CreditCard className="w-3 h-3" /> :
                           expense.paymentMode === 'Cash'        ? <Banknote   className="w-3 h-3" /> :
                                                                   <Landmark   className="w-3 h-3" />}
                          {expense.paymentMode}
                        </span>
                      </div>
                    </div>
                    <span className="font-bold text-lg tabular-nums flex-shrink-0">{formatAmount(expense.amount)}</span>
                  </div>

                  {/* Full-width, labelled actions — unmistakably tappable with a thumb. */}
                  <div className="flex gap-2.5 mt-4 pt-3.5 border-t border-white/[0.06]">
                    <Button variant="outline" className="flex-1 h-11 gap-2" onClick={() => openEdit(expense)}>
                      <Pencil className="w-4 h-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-11 gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                      onClick={() => setDeleteId(expense._id)}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>

      </div>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete expense?"
        description="This expense will be permanently removed."
        onConfirm={confirmDelete}
      />
    </Layout>
  );
}
