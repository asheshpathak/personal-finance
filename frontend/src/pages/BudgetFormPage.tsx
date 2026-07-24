import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrency } from '@/context/CurrencyContext';
import { EXPENSE_CATEGORIES } from '@/lib/expenseCategories';
import { api } from '@/lib/api';

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

const toDateInputValue = (dateStr: string) => new Date(dateStr).toISOString().split('T')[0];

export default function BudgetFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatAmount } = useCurrency();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(isEditing);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [categories, setCategories] = useState<CategoryAllocation[]>([{ name: '', allocatedAmount: 0 }]);

  useEffect(() => {
    if (!id) return;

    const fetchBudget = async () => {
      try {
        const budgets = await api.get<Budget[]>('/api/budgets');
        const budget = budgets.find(b => b._id === id);
        if (!budget) {
          navigate('/budgets');
          return;
        }
        setStartDate(toDateInputValue(budget.startDate));
        setEndDate(toDateInputValue(budget.endDate));
        setIsActive(budget.isActive);
        setCategories(
          budget.categories.length > 0
            ? budget.categories.map(({ name, allocatedAmount }: CategoryAllocation) => ({ name, allocatedAmount }))
            : [{ name: '', allocatedAmount: 0 }]
        );
      } catch (error) {
        console.error(error);
        navigate('/budgets');
      } finally {
        setLoading(false);
      }
    };

    fetchBudget();
  }, [id, navigate]);

  const handleAddCategory = () => {
    setCategories([...categories, { name: '', allocatedAmount: 0 }]);
  };

  const handleRemoveCategory = (index: number) => {
    const newCategories = [...categories];
    newCategories.splice(index, 1);
    setCategories(newCategories);
  };

  const handleCategoryChange = (index: number, field: keyof CategoryAllocation, value: string | number) => {
    const newCategories = [...categories];
    newCategories[index] = { ...newCategories[index], [field]: value };
    setCategories(newCategories);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { startDate, endDate, isActive, categories };
      if (isEditing) {
        await api.put(`/api/budgets/${id}`, payload);
      } else {
        await api.post('/api/budgets', payload);
      }
      navigate('/budgets');
    } catch (error) {
      console.error(error);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="py-12 text-center text-muted-foreground">Loading budget...</div>
      </Layout>
    );
  }

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
              {isEditing ? 'Update your budget dates and category allocations.' : 'Set your spending limits by category.'}
            </p>
          </div>
        </div>

        <Card className="rounded-2xl border-2">
          <CardHeader>
            <CardTitle className="text-lg">Budget Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveBudget} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>

              <label htmlFor="isActive" className="flex items-center gap-3 py-2 min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium leading-none">Set as Active Budget</span>
              </label>

              <div className="space-y-4 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Category Allocations</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddCategory} className="h-10">
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>

                {categories.map((cat, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="flex-1 space-y-2">
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <Select value={cat.name} onValueChange={(val) => handleCategoryChange(index, 'name', val)} required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Label className="text-xs text-muted-foreground">Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        required
                        value={cat.allocatedAmount || ''}
                        onChange={(e) => handleCategoryChange(index, 'allocatedAmount', Number(e.target.value))}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      className="w-full sm:w-9 sm:h-9 sm:p-0 sm:mb-[2px] flex-shrink-0 sm:self-end"
                      onClick={() => handleRemoveCategory(index)}
                      disabled={categories.length === 1}
                    >
                      <Trash2 className="w-4 h-4 sm:mr-0 mr-2" />
                      <span className="sm:hidden">Remove category</span>
                    </Button>
                  </div>
                ))}

                <div className="text-sm font-medium text-right text-muted-foreground pt-2 border-t">
                  Total: {formatAmount(categories.reduce((acc, curr) => acc + (curr.allocatedAmount || 0), 0))}
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <Button type="button" variant="outline" className="rounded-xl sm:flex-1" onClick={() => navigate('/budgets')}>
                  Cancel
                </Button>
                <Button type="submit" className="rounded-xl sm:flex-1 bg-foreground text-background hover:bg-foreground/90">
                  {isEditing ? 'Update Budget' : 'Save Budget'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
