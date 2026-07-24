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
import { CategorySpendChart } from '@/components/CategorySpendChart';
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

interface CategoryAllocation {
  name: string;
  allocatedAmount: number;
}

interface Budget {
  _id: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  categories: CategoryAllocation[];
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

  // Filtered expenses for the Recent Transactions table
  const filteredExpenses = (() => {
    const days = FILTERS.find(f => f.key === activeFilter)?.days ?? 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
    return expenses.filter(e => new Date(e.date) >= cutoff).sort(byRecency);
  })()

  // Budget Utilization Logic
  let budgetUtilization: { category: string, allocated: number, spent: number, remaining: number, percentage: number, rawPercentage: number }[] = [];
  if (activeBudget) {
    const start = new Date(activeBudget.startDate).getTime();
    const end = new Date(activeBudget.endDate).setHours(23, 59, 59, 999);
    
    const expensesInBudget = expenses.filter(exp => {
      const expDate = new Date(exp.date).getTime();
      return expDate >= start && expDate <= end;
    });

    budgetUtilization = activeBudget.categories.map(cat => {
      const spent = expensesInBudget
        .filter(e => e.category === cat.name)
        .reduce((sum, e) => sum + e.amount, 0);
      const remaining = cat.allocatedAmount - spent;
      const rawPercentage = cat.allocatedAmount > 0 ? (spent / cat.allocatedAmount) * 100 : 0;

      return {
        category: cat.name,
        allocated: cat.allocatedAmount,
        spent,
        remaining,
        // Capped — drives bar width, which can never exceed its track.
        percentage: Math.min(rawPercentage, 100),
        // Uncapped — what gets displayed, so 140% doesn't read as 100%.
        rawPercentage,
      };
    });

    // Rank by spend, heaviest first. Allocation breaks ties so a fresh budget
    // (every category at zero) still ranks by intent rather than arbitrarily.
    budgetUtilization.sort((a, b) => b.spent - a.spent || b.allocated - a.allocated);
  }

  // Roll-up for the summary strip above the rows.
  const budgetSummary = (() => {
    if (!activeBudget) return null;

    const allocated = budgetUtilization.reduce((sum, c) => sum + c.allocated, 0);
    const spent = budgetUtilization.reduce((sum, c) => sum + c.spent, 0);
    const percentage = allocated > 0 ? (spent / allocated) * 100 : 0;

    const end = new Date(activeBudget.endDate).setHours(23, 59, 59, 999);
    const msLeft = end - Date.now();
    const daysLeft = msLeft > 0 ? Math.ceil(msLeft / 86_400_000) : 0;

    return { allocated, spent, remaining: allocated - spent, percentage, daysLeft };
  })();

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8">
        
        {/* Header Section */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Total Spent
              {activeBudget && (
                <span className="normal-case tracking-normal">
                  {' · '}
                  {new Date(activeBudget.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} -{' '}
                  {new Date(activeBudget.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </h2>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tighter">{formatAmount(totalExpense)}</h1>
            </div>
          </div>
          
          <div className="flex gap-3 flex-shrink-0">
            {/* Add Expense Dialog */}
            <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button className="rounded-xl px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Expense
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Add New Expense</DialogTitle>
                </DialogHeader>
                <ExpenseForm values={form} onChange={patchForm} onSubmit={handleAddExpense} submitLabel="Save Expense" />
              </DialogContent>
            </Dialog>
            
            {/* Edit dialog (opened programmatically) */}
            <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if(!open) resetForm(); }}>
              <DialogContent className="sm:max-w-[425px] rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Edit Expense</DialogTitle>
                </DialogHeader>
                <ExpenseForm values={form} onChange={patchForm} onSubmit={handleEditExpense} submitLabel="Update Expense" />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Active Budget Utilization */}
        {activeBudget && budgetSummary && (
          <BudgetUtilizationCard
            startDate={activeBudget.startDate}
            endDate={activeBudget.endDate}
            categories={budgetUtilization}
            summary={budgetSummary}
          />
        )}

        {/* Spending by Category */}
        <CategorySpendChart expenses={expenses} formatAmount={formatAmount} />

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
                <Card key={expense._id} className="rounded-2xl border shadow-sm bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{expense.description || expense.category}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(expense.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
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
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className="font-bold text-base">{formatAmount(expense.amount)}</span>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(expense)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(expense._id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
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
