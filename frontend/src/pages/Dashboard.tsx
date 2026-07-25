import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, CreditCard, Banknote, Landmark, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { api } from '@/lib/api';
import { BudgetUtilizationCard } from '@/components/BudgetUtilizationCard';
import { ExpenseForm, emptyExpenseForm, toDateInputValue } from '@/components/ExpenseForm';
import type { ExpenseFormValues } from '@/components/ExpenseForm';
import { computeBudgetUtilization, nonEmptySections, type Budget } from '@/lib/budgetSections';

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

export default function Dashboard() {
  const { formatAmount } = useCurrency();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [activeBudget, setActiveBudget] = useState<Budget | null>(null);
  
  // Add Expense State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<ExpenseFormValues>(emptyExpenseForm);
  const patchForm = (patch: Partial<ExpenseFormValues>) => setForm(prev => ({ ...prev, ...patch }));

  // Edit Expense State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Filter State
  type FilterKey = '1D' | '3D' | '5D' | '1W' | '1M';
  const [activeFilter, setActiveFilter] = useState<FilterKey>('1W');
  const FILTERS: { label: string; key: FilterKey; days: number }[] = [
    { label: '1D', key: '1D', days: 1 },
    { label: '3D', key: '3D', days: 3 },
    { label: '5D', key: '5D', days: 5 },
    { label: '1W', key: '1W', days: 7 },
    { label: '1M', key: '1M', days: 30 },
  ];

  const fetchExpenses = async () => {
    try {
      const data = await api.get<Expense[]>('/api/expenses');
      setExpenses(data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchActiveBudget = async () => {
    try {
      const data = await api.get<Budget[]>('/api/budgets');
      const active = data.find(b => b.isActive);
      setActiveBudget(active || null);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchExpenses();
    fetchActiveBudget();
  }, []);

  // Send the date as local noon so the stored UTC instant can't slip to the
  // adjacent day for users far from UTC.
  const toPayload = (values: ExpenseFormValues) => ({
    amount: Number(values.amount),
    category: values.category,
    paymentMode: values.paymentMode,
    description: values.description,
    date: new Date(`${values.date}T12:00:00`).toISOString(),
  });

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/expenses', toPayload(form));
      setIsAddOpen(false);
      resetForm();
      fetchExpenses();
    } catch (error) {
      console.error(error);
    }
  };

  const handleEditExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editExpenseId) return;
    try {
      await api.put(`/api/expenses/${editExpenseId}`, toPayload(form));
      setIsEditOpen(false);
      resetForm();
      fetchExpenses();
    } catch (error) {
      console.error(error);
    }
  };

  const confirmDeleteExpense = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/expenses/${deleteId}`);
      fetchExpenses();
    } catch (error) {
      console.error(error);
    }
  };

  const openEditDialog = (expense: Expense) => {
    setEditExpenseId(expense._id);
    setForm({
      amount: expense.amount.toString(),
      category: expense.category,
      paymentMode: expense.paymentMode,
      description: expense.description || '',
      date: toDateInputValue(expense.date),
    });
    setIsEditOpen(true);
  };

  const resetForm = () => {
    setForm(emptyExpenseForm());
    setEditExpenseId(null);
  };

  const totalExpense = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  // Filtered expenses for the Recent Transactions table
  const filteredExpenses = (() => {
    const days = FILTERS.find(f => f.key === activeFilter)?.days ?? 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
    return expenses.filter(e => new Date(e.date) >= cutoff).sort(byRecency);
  })()

  // Every section of the active budget measured against what's been recorded.
  const budgetBreakdown = activeBudget ? computeBudgetUtilization(activeBudget, expenses) : null;

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8">
        
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-hero p-6 sm:p-8 lg:p-10 animate-fade-up">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground/80">{greeting}</p>
              <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-foreground/50">
                Total spent
                {activeBudget && (
                  <span className="text-foreground/40">
                    {' · '}
                    {new Date(activeBudget.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
                    {new Date(activeBudget.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </p>
              <h1 className="mt-1.5 text-[2.75rem] leading-none sm:text-6xl font-extrabold tracking-tighter tabular-nums">
                {formatAmount(totalExpense)}
              </h1>
            </div>

            <div className="flex-shrink-0">
              {/* Add Expense Dialog */}
              <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(!open) resetForm(); }}>
                <DialogTrigger asChild>
                  <Button size="lg" className="w-full sm:w-auto px-7">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Expense
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Add New Expense</DialogTitle>
                  </DialogHeader>
                  <ExpenseForm values={form} onChange={patchForm} onSubmit={handleAddExpense} submitLabel="Save Expense" showShortcuts />
                </DialogContent>
              </Dialog>

              {/* Edit dialog (opened programmatically) */}
              <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if(!open) resetForm(); }}>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Edit Expense</DialogTitle>
                  </DialogHeader>
                  <ExpenseForm values={form} onChange={patchForm} onSubmit={handleEditExpense} submitLabel="Update Expense" />
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Active Budget Utilization */}
        {activeBudget && budgetBreakdown && (
          <BudgetUtilizationCard
            startDate={activeBudget.startDate}
            endDate={activeBudget.endDate}
            sections={nonEmptySections(budgetBreakdown.sections)}
            totals={budgetBreakdown.totals}
          />
        )}

        {/* Spending by Category */}
        {/* Recent Transactions */}
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h3 className="text-lg font-bold tracking-tight">Recent Transactions</h3>
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map((f) => (
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
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No expenses in this period.</TableCell>
                  </TableRow>
                ) : (
                  filteredExpenses.map((expense) => (
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
                          {expense.paymentMode === 'Credit Card' ? <CreditCard className="w-4 h-4"/> : 
                           expense.paymentMode === 'Cash' ? <Banknote className="w-4 h-4"/> : <Landmark className="w-4 h-4" />}
                          <span className="text-sm">{expense.paymentMode}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold whitespace-nowrap">
                        {formatAmount(expense.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(expense)}>
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
              filteredExpenses.map((expense) => (
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
                          {expense.paymentMode === 'Credit Card' ? <CreditCard className="w-3 h-3"/> :
                           expense.paymentMode === 'Cash' ? <Banknote className="w-3 h-3"/> : <Landmark className="w-3 h-3" />}
                          {expense.paymentMode}
                        </span>
                      </div>
                    </div>
                    <span className="font-bold text-lg tabular-nums flex-shrink-0">{formatAmount(expense.amount)}</span>
                  </div>

                  {/* Full-width, labelled actions — unmistakably tappable with a thumb. */}
                  <div className="flex gap-2.5 mt-4 pt-3.5 border-t border-white/[0.06]">
                    <Button
                      variant="outline"
                      className="flex-1 h-11 gap-2"
                      onClick={() => openEditDialog(expense)}
                    >
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
        onConfirm={confirmDeleteExpense}
      />
    </Layout>
  );
}
