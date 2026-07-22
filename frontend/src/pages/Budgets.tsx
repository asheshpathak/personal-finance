import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Calendar, CheckCircle2, Circle, Pencil } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { api } from '@/lib/api';

interface CategoryAllocation {
  name: string;
  allocatedAmount: number;
  _id?: string;
}

interface Budget {
  _id: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  categories: CategoryAllocation[];
}

export default function Budgets() {
  const { formatAmount } = useCurrency();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchBudgets = async () => {
    try {
      const data = await api.get<Budget[]>('/api/budgets');
      setBudgets(data);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchBudgets();
  }, []);

  const handleSetActive = async (id: string, currentBudget: Budget) => {
    try {
      await api.put(`/api/budgets/${id}`, { ...currentBudget, isActive: true });
      fetchBudgets();
    } catch (error) {
      console.error(error);
    }
  };

  const confirmDeleteBudget = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/budgets/${deleteId}`);
      fetchBudgets();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter">Budget Planning</h1>
            <p className="text-muted-foreground mt-2">Manage and allocate your spending limits.</p>
          </div>
          <Button className="rounded-xl px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm w-full sm:w-auto" asChild>
            <Link to="/budgets/new">
              <Plus className="w-4 h-4 mr-2" />
              New Budget
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {budgets.length === 0 ? (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              No budgets found. Create one to start planning!
            </div>
          ) : (
            budgets.map((budget) => {
              const totalAllocated = budget.categories.reduce((acc, curr) => acc + curr.allocatedAmount, 0);
              return (
                <Card key={budget._id} className={`rounded-2xl border-2 transition-all ${budget.isActive ? 'border-primary/50 shadow-md bg-primary/5' : 'border-border'}`}>
                  <CardHeader className="pb-4 border-b">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base sm:text-lg flex items-center gap-2 flex-wrap">
                          <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">
                            {new Date(budget.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
                            {new Date(budget.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </CardTitle>
                        <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-background border">
                          {budget.isActive ? <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                          {budget.isActive ? <span className="text-primary">Active</span> : <span className="text-muted-foreground">Inactive</span>}
                        </div>
                      </div>
                      <div className="flex -mt-2 -mr-2 flex-shrink-0">
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-muted" asChild>
                          <Link to={`/budgets/${budget._id}/edit`}>
                            <Pencil className="w-4 h-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(budget._id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 pb-6">
                    <div className="mb-4">
                      <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Allocated</span>
                      <div className="text-2xl sm:text-3xl font-bold tracking-tighter mt-1">{formatAmount(totalAllocated)}</div>
                    </div>
                    <div className="space-y-3">
                      {budget.categories.map((cat, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <span className="font-medium text-muted-foreground">{cat.name}</span>
                          <span className="font-semibold">{formatAmount(cat.allocatedAmount)}</span>
                        </div>
                      ))}
                    </div>
                    {!budget.isActive && (
                      <Button variant="outline" className="w-full mt-6 rounded-xl" onClick={() => handleSetActive(budget._id, budget)}>
                        Set as Active
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete budget?"
        description="This budget and all its category allocations will be permanently removed."
        onConfirm={confirmDeleteBudget}
      />
    </Layout>
  );
}
